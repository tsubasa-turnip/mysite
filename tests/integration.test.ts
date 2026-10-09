import { beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, asUser } from '../src/lib/db';
import { seal, open } from '../src/lib/crypto';
import { parseExport } from '../src/lib/import-parser';
import { createImport, processJob, listJobs, controlJob, deleteImport } from '../src/lib/imports';
import {
  listCandidates,
  reviewCandidate,
  listEntries,
  saveEntry,
  deleteEntry,
} from '../src/lib/journals';
import { getMessage, getConversation, deleteAllData, exportData } from '../src/lib/data';
import { reflect, generateInsight, retrieve, allSources } from '../src/lib/reflect';
import { chartSeries } from '../src/lib/dates';
import { emptyContent } from '../src/lib/ai';
import { fixtureBytes } from './fixtures';
process.env.INNER_WEATHER_DB = 'memory';
process.env.DATA_ENCRYPTION_KEY = '11'.repeat(32);
async function account() {
  const id = randomUUID();
  await (await db()).query('INSERT INTO users(id,email) VALUES($1,$2)', [id, id + '@example.test']);
  await asUser(id, (tx) => tx.query('INSERT INTO profiles(user_id) VALUES($1)', [id]));
  return id;
}
async function finish(user: string, id: string) {
  for (let i = 0; i < 10; i++) {
    const job = (await listJobs(user)).find((j) => j.id === id);
    if (job?.status === 'completed') return;
    await processJob(user, id);
  }
  throw new Error('Job did not complete');
}
const parsed = () => parseExport(fixtureBytes(), 'conversations.json');
beforeAll(async () => {
  await db();
});
describe('durable journal and import workflow', () => {
  it('encrypts sensitive payloads, detects tampering and enforces RLS', async () => {
    const a = await account(),
      b = await account();
    const id = await saveEntry(a, {
      ...emptyContent(),
      text: 'private words',
      emotions: { anxiety: 0 },
      event_date: '2026-10-04',
      date_kind: 'explicit',
      anchor: true,
    });
    expect(await listEntries(b)).toEqual([]);
    const rows = await (await db()).query('SELECT payload FROM journal_entries WHERE id=$1', [id]);
    expect(rows[0].payload).not.toContain('private words');
    expect(open(rows[0].payload)).toMatchObject({ text: 'private words' });
    const ciphertext = seal({ text: 'secret' });
    expect(() => open(ciphertext.slice(0, -4) + 'AAAA')).toThrow();
    await expect(
      saveEntry(
        b,
        { ...emptyContent(), text: 'steal', event_date: null, date_kind: 'unknown' },
        id,
      ),
    ).rejects.toThrow(/見つかりません/);
    expect((await listEntries(a))[0].text).toBe('private words');
  });
  it('prevents foreign-user references at the database boundary', async () => {
    const a = await account(),
      b = await account();
    const id = await saveEntry(a, {
      ...emptyContent(),
      text: 'mine',
      event_date: null,
      date_kind: 'unknown',
    });
    await expect(
      asUser(b, (tx) =>
        tx.query('INSERT INTO anchors(id,user_id,journal_id) VALUES($1,$2,$3)', [
          randomUUID(),
          b,
          id,
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(b, (tx) =>
        tx.query("INSERT INTO profiles(user_id,display_name) VALUES($1,'injected')", [a]),
      ),
    ).rejects.toThrow();
  });
  it('imports immutable raw data, extracts only selected user messages, and confirms corrected emotion scores', async () => {
    const u = await account();
    const j = await createImport(u, parsed(), ['conversation-1'], 'local', false);
    expect(j.added).toBe(5);
    expect(await listCandidates(u)).toHaveLength(0);
    await finish(u, j.id);
    const cs = await listCandidates(u);
    expect(cs).toHaveLength(2);
    expect(cs.some((c) => c.text.includes('選択されていない'))).toBe(false);
    expect(cs.some((c) => c.text.includes('毎日幸せ'))).toBe(false);
    expect(await listEntries(u)).toHaveLength(0);
    const c = cs.find((v) => v.date_kind === 'explicit')!;
    const original = await getMessage(u, c.source_message_id);
    const id = await reviewCandidate(u, c.id, {
      ...c,
      text: '修正した本人の記録',
      emotions: { anxiety: 0, calm: 8 },
      event_date: '2026-10-04',
      date_kind: 'explicit',
      anchor: true,
    });
    const entries = await listEntries(u);
    expect(entries).toHaveLength(1);
    expect(entries[0].source_message_id).toBe(c.source_message_id);
    expect(entries[0].anchor).toBe(true);
    expect(chartSeries(entries, '2026-10-04', '2026-10-04')[0]).toMatchObject({
      anxiety: 0,
      calm: 8,
    });
    const after = await getMessage(u, c.source_message_id);
    expect(after.messages).toEqual(original.messages);
    expect((await listCandidates(u)).find((x) => x.id === c.id)?.text).not.toBe(
      '修正した本人の記録',
    );
    await reviewCandidate(u, c.id, { ...entries[0], emotions: { calm: 7 } });
    expect(await listEntries(u)).toHaveLength(1);
    expect((await listEntries(u))[0].emotions).toEqual({ calm: 7 });
    expect(id).toBeTruthy();
  });
  it('is idempotent across repeated exports and supports incremental messages', async () => {
    const u = await account();
    const first = await createImport(u, parsed(), ['conversation-1'], 'local', false);
    await finish(u, first.id);
    const again = await createImport(u, parsed(), ['conversation-1'], 'local', false);
    expect(again.added).toBe(0);
    expect(again.duplicates).toBe(5);
    expect(again.total).toBe(0);
    expect(await listCandidates(u)).toHaveLength(2);
    const diff = await createImport(
      u,
      parseExport(fixtureBytes(true), 'conversations.json'),
      ['conversation-1'],
      'local',
      false,
    );
    expect(diff.added).toBe(2);
    await finish(u, diff.id);
    expect(await listCandidates(u)).toHaveLength(3);
  });
  it('supports pause, durable resume and competing step calls without double extraction', async () => {
    const u = await account();
    const j = await createImport(u, parsed(), ['conversation-1'], 'local', false);
    await processJob(u, j.id);
    await controlJob(u, j.id, 'pause');
    const n = (await listCandidates(u)).length;
    await processJob(u, j.id);
    expect(await listCandidates(u)).toHaveLength(n);
    await controlJob(u, j.id, 'resume');
    await Promise.all([processJob(u, j.id), processJob(u, j.id)]);
    await finish(u, j.id);
    expect(await listCandidates(u)).toHaveLength(2);
    expect((await listJobs(u))[0].processed).toBe(2);
  });
  it('requires explicit external-AI consent before importing', async () => {
    const u = await account();
    await expect(createImport(u, parsed(), ['conversation-1'], 'openai', false)).rejects.toThrow(
      /同意/,
    );
    expect(await listJobs(u)).toHaveLength(0);
  });
  it('returns date-linked sources for reflections and weekly/monthly reviews', async () => {
    const u = await account();
    await saveEntry(u, {
      ...emptyContent(),
      text: '仕事で不安だった。散歩で回復し、人とのつながりが大切だと気づいた。',
      emotions: { anxiety: 3 },
      event_date: '2026-10-04',
      date_kind: 'explicit',
    });
    const r = await reflect(u, '仕事の不安からどう回復した？', 'local', false);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].date).toBe('2026-10-04');
    expect(r.sources[0].type).toBe('journal');
    for (const p of ['week', 'month'] as const) {
      const insight = await generateInsight(u, p, '2026-10-01', '2026-10-08', 'local', false);
      expect(insight.sources[0].id).toBe(r.sources[0].id);
    }
    await expect(reflect(u, 'test', 'openai', false)).rejects.toThrow(/同意/);
  });
  it('honors explicit and relative date ranges in cross-source search', () => {
    const sources = [
      { id: 'a', date: '2026-10-04', text: '仕事', label: 'a', type: 'journal' as const },
      { id: 'b', date: '2026-04-03', text: '悩み', label: 'b', type: 'journal' as const },
      { id: 'c', date: null, text: '悩み', label: 'c', type: 'journal' as const },
    ];
    expect(retrieve('2026年10月を振り返って', sources).map((s) => s.id)).toEqual(['a']);
    expect(
      retrieve('半年前の自分は何に悩んでいた？', sources, new Date('2026-10-08Z')).map((s) => s.id),
    ).toEqual(['b']);
  });
  it('retains shared originals until the final import is deleted, then cascades scores and journals', async () => {
    const u = await account();
    const a = await createImport(u, parsed(), ['conversation-1'], 'local', false);
    await finish(u, a.id);
    const [c] = await listCandidates(u);
    await reviewCandidate(u, c.id, {
      ...c,
      event_date: '2026-10-04',
      date_kind: 'explicit',
      anchor: true,
    });
    const b = await createImport(u, parsed(), ['conversation-1'], 'local', false);
    await deleteImport(u, a.id);
    expect(await listEntries(u)).toHaveLength(1);
    expect((await getMessage(u, c.source_message_id)).messages).toHaveLength(5);
    await deleteImport(u, b.id);
    expect(await listCandidates(u)).toHaveLength(0);
    expect(await listEntries(u)).toHaveLength(0);
    for (const table of [
      'emotion_scores',
      'anchors',
      'imported_messages',
      'imported_conversations',
    ])
      expect(await asUser(u, (tx) => tx.query(`SELECT * FROM ${table}`))).toHaveLength(0);
  });
  it('denies access to another user source and preserves data isolation during complete deletion', async () => {
    const a = await account(),
      b = await account();
    const j = await createImport(a, parsed(), ['conversation-1'], 'local', false);
    await finish(a, j.id);
    const [c] = await listCandidates(a);
    await expect(getMessage(b, c.source_message_id)).rejects.toThrow(/見つかりません/);
    await saveEntry(b, {
      ...emptyContent(),
      text: 'user B survives',
      event_date: null,
      date_kind: 'unknown',
    });
    const exported = await exportData(a);
    expect((exported.imported_messages as unknown[]).length).toBe(5);
    await deleteAllData(a);
    expect(await listJobs(a)).toHaveLength(0);
    expect(await listCandidates(a)).toHaveLength(0);
    expect(await listEntries(b)).toHaveLength(1);
  });
  it('deleting a confirmed journal rejects its candidate without deleting the original', async () => {
    const u = await account();
    const j = await createImport(u, parsed(), ['conversation-1'], 'local', false);
    await finish(u, j.id);
    const [c] = await listCandidates(u);
    const id = await reviewCandidate(u, c.id, { ...c, event_date: null, date_kind: 'unknown' });
    await deleteEntry(u, id!);
    expect((await listCandidates(u)).find((v) => v.id === c.id)?.status).toBe('rejected');
    expect((await getMessage(u, c.source_message_id)).messages.length).toBeGreaterThan(0);
  });
});
it('stages large imports durably, resumes ingestion batches, and deduplicates partial restarts', async () => {
  const u = await account();
  const conversations = Array.from({ length: 42 }, (_, i) => {
    const c = parsed().conversations[0];
    return { ...c, id: 'large-' + i };
  });
  const job = await createImport(
    u,
    { ...parsed(), conversations },
    conversations.map((c) => c.id),
    'local',
    false,
  );
  expect((await listJobs(u))[0].stage).toBe('ingest');
  expect((await listJobs(u))[0].ingest_total).toBe(210);
  await processJob(u, job.id);
  expect((await listJobs(u))[0].ingest_cursor).toBe(25);
  await controlJob(u, job.id, 'pause');
  await processJob(u, job.id);
  expect((await listJobs(u))[0].ingest_cursor).toBe(25);
  await controlJob(u, job.id, 'resume');
  for (let i = 0; i < 9; i++) await processJob(u, job.id);
  const state = (await listJobs(u))[0];
  expect(state.stage).toBe('extract');
  expect(state.ingest_cursor).toBe(210);
  expect(state.added).toBe(210);
  expect(state.total).toBe(84);
  const raw = await asUser(u, (tx) =>
    tx.query('SELECT staging_payload FROM import_jobs WHERE id=$1', [job.id]),
  );
  expect(raw[0].staging_payload).toBeNull();
  await deleteImport(u, job.id);
  expect(await listCandidates(u)).toHaveLength(0);
  expect(await asUser(u, (tx) => tx.query('SELECT * FROM imported_messages'))).toHaveLength(0);
});

it('keeps original conversations searchable after confirming an unknown event date', async () => {
  const u = await account();
  const j = await createImport(u, parsed(), ['conversation-1'], 'local', false);
  await finish(u, j.id);
  const [c] = await listCandidates(u);
  await reviewCandidate(u, c.id, { ...c, event_date: null, date_kind: 'unknown' });
  const sources = await allSources(u);
  expect(sources.some((s) => s.id === c.source_message_id)).toBe(true);
  const results = retrieve('2026年10月の記録', sources);
  expect(results.some((s) => s.id === c.source_message_id)).toBe(true);
  const canonicalIds = results.map((s) => s.source_message_id || s.id);
  expect(new Set(canonicalIds).size).toBe(canonicalIds.length);
});
