// Explicit, synthetic-only live verification. No credentials or journal text are logged.
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';
loadEnvConfig(process.cwd());
const required = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATA_ENCRYPTION_KEY',
];
const missing = required.filter((name) => !process.env[name]);
if (!process.env.OPENAI_API_KEY && !process.env.IW_OPENAI_API_KEY)
  missing.push('OPENAI_API_KEY or IW_OPENAI_API_KEY');
if (missing.length) {
  console.error('Live verification blocked. Set securely: ' + missing.join(', '));
  process.exit(2);
}
if (process.env.LIVE_TEST_APPROVED !== '1') {
  console.error(
    'This test creates/deletes two synthetic Supabase accounts and makes up to five billable OpenAI calls. Set LIVE_TEST_APPROVED=1 only after user approval.',
  );
  process.exit(2);
}
const { db, asUser } = await import('../src/lib/db');
const { saveEntry, listEntries, listCandidates, reviewCandidate } =
  await import('../src/lib/journals');
const { createImport, processJob, listJobs } = await import('../src/lib/imports');
const { parseExport } = await import('../src/lib/import-parser');
const { reflect, generateInsight } = await import('../src/lib/reflect');
const { getMessage } = await import('../src/lib/data');
const { chartSeries } = await import('../src/lib/dates');
const { emptyContent } = await import('../src/lib/ai');
const { fixtureBytes } = await import('../tests/fixtures');
const url = process.env.SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const testIds: string[] = [];
let failed = false;
try {
  const database = await db();
  await database.query('SELECT id FROM users LIMIT 0');
  console.log('PASS database connectivity and migration availability');
  for (let i = 0; i < 2; i++) {
    const email = `iw-synthetic-${randomUUID()}@example.invalid`,
      password = randomBytes(24).toString('hex');
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error || !result.data.user)
      throw new Error('Supabase synthetic account creation failed');
    const id = result.data.user.id;
    testIds.push(id);
    const auth = createClient(url, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await auth.auth.signInWithPassword({ email, password });
    if (login.error || login.data.user?.id !== id)
      throw new Error('Supabase password authentication failed');
    const validated = await auth.auth.getUser(login.data.session!.access_token);
    if (validated.error || validated.data.user?.id !== id)
      throw new Error('Supabase token validation failed');
    await database.query("INSERT INTO users(id,email,auth_kind) VALUES($1,$2,'supabase')", [
      id,
      email,
    ]);
    await asUser(id, (tx) =>
      tx.query('INSERT INTO profiles(user_id,ai_consent) VALUES($1,true)', [id]),
    );
  }
  console.log('PASS Supabase Auth with two synthetic identities');
  const [a, b] = testIds;
  await saveEntry(a, {
    ...emptyContent(),
    text: '合成テスト：2026年10月4日、仕事を終えて散歩した。安心し、人とのつながりが大切だと感じた。',
    event_date: '2026-10-04',
    date_kind: 'explicit',
    emotions: { anxiety: 0, calm: 7 },
    anchor: true,
  });
  if ((await listEntries(b)).length !== 0) throw new Error('Tenant isolation failed');
  console.log('PASS live PostgreSQL RLS and journal persistence');
  const j = await createImport(
    a,
    parseExport(fixtureBytes(), 'synthetic-conversations.json'),
    ['conversation-1'],
    'openai',
    true,
  );
  for (let i = 0; i < 20; i++) {
    await processJob(a, j.id);
    const state = (await listJobs(a))[0];
    if (state.status === 'completed') break;
    if (['failed', 'paused'].includes(state.status))
      throw new Error('AI extraction failed or paused; inspect the synthetic job status');
    await new Promise((r) => setTimeout(r, 1500));
  }
  const state = (await listJobs(a))[0];
  if (state.status !== 'completed') throw new Error('Extraction did not complete');
  const candidates = await listCandidates(a);
  if (candidates.length !== 2) throw new Error('Unexpected extraction count');
  const c = candidates[0];
  const before = await getMessage(a, c.source_message_id);
  await reviewCandidate(a, c.id, {
    ...c,
    event_date: '2026-10-04',
    date_kind: 'explicit',
    emotions: { anxiety: 0, calm: 8 },
  });
  const after = await getMessage(a, c.source_message_id);
  if (JSON.stringify(before.messages) !== JSON.stringify(after.messages))
    throw new Error('Original source was modified');
  if (chartSeries(await listEntries(a), '2026-10-04', '2026-10-04')[0].anxiety !== 0)
    throw new Error('Zero score lost');
  console.log('PASS OpenAI extraction, correction, original preservation and chart data');
  for (const period of ['week', 'month'] as const) {
    const review = await generateInsight(a, period, '2026-10-01', '2026-10-08', 'openai', true);
    if (!review.sources.length) throw new Error('Missing review citations');
  }
  const answer = await reflect(a, '仕事で不安だったとき、回復のきっかけは？', 'openai', true);
  if (!answer.sources.length) throw new Error('Missing reflection citations');
  console.log('PASS weekly/monthly OpenAI reviews and source-linked reflection');
} catch (error) {
  failed = true;
  console.error(
    'Live verification failed:',
    error instanceof Error ? error.name : 'Unknown failure',
  );
} finally {
  for (const id of testIds) {
    try {
      await (await db()).query('DELETE FROM users WHERE id=$1', [id]);
      const result = await admin.auth.admin.deleteUser(id);
      if (result.error) throw new Error('Auth cleanup failed');
    } catch {
      failed = true;
      console.error('Synthetic account cleanup requires attention for ID:', id);
    }
  }
}
if (failed) process.exit(1);
console.log('PASS synthetic test data cleanup');
process.exit(0);
