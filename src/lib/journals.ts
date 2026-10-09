import { randomUUID } from 'node:crypto';
import { asUser, type Tx, day, iso } from './db';
import { open, seal } from './crypto';
import { journalSchema, AppError } from './validation';
import type { Entry, JournalContent, CandidateContent, Candidate } from './types';
export async function listEntries(userId: string) {
  return asUser(userId, async (tx) =>
    (
      await tx.query(
        'SELECT j.*, a.id AS anchor FROM journal_entries j LEFT JOIN anchors a ON a.journal_id=j.id ORDER BY j.recorded_at DESC',
        [],
      )
    ).map(
      (r) =>
        ({
          ...open<JournalContent>(r.payload),
          id: r.id,
          recorded_at: iso(r.recorded_at)!,
          event_date: day(r.event_date),
          date_kind: r.date_kind,
          source_message_id: r.source_message_id,
          candidate_id: r.candidate_id,
          anchor: !!r.anchor,
        }) as Entry,
    ),
  );
}
export async function writeEntry(
  tx: Tx,
  userId: string,
  input: unknown,
  id?: string,
  source?: { messageId: string; candidateId: string },
) {
  const v = journalSchema.parse(input);
  const entryId = id || randomUUID();
  const { event_date, date_kind, recorded_at, anchor, ...content } = v;
  if (id) {
    const rows = await tx.query(
      'UPDATE journal_entries SET payload=$1,event_date=$2,date_kind=$3,recorded_at=coalesce($4::timestamptz,recorded_at),updated_at=now() WHERE id=$5 RETURNING id',
      [seal(content), event_date, date_kind, recorded_at ?? null, id],
    );
    if (!rows.length) throw new AppError(404, '日記が見つかりません');
  } else
    await tx.query(
      'INSERT INTO journal_entries(id,user_id,event_date,date_kind,recorded_at,payload,source_message_id,candidate_id) VALUES($1,$2,$3,$4,coalesce($5::timestamptz,now()),$6,$7,$8)',
      [
        entryId,
        userId,
        event_date,
        date_kind,
        recorded_at ?? null,
        seal(content),
        source?.messageId ?? null,
        source?.candidateId ?? null,
      ],
    );
  await tx.query('DELETE FROM emotion_scores WHERE journal_id=$1', [entryId]);
  for (const [emotion, score] of Object.entries(content.emotions))
    if (score !== undefined)
      await tx.query(
        'INSERT INTO emotion_scores(id,user_id,journal_id,emotion_id,score) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), userId, entryId, emotion, score],
      );
  if (anchor)
    await tx.query(
      'INSERT INTO anchors(id,user_id,journal_id) VALUES($1,$2,$3) ON CONFLICT(journal_id) DO NOTHING',
      [randomUUID(), userId, entryId],
    );
  else await tx.query('DELETE FROM anchors WHERE journal_id=$1', [entryId]);
  // Stored summaries can contain obsolete facts after a correction.
  await tx.query('DELETE FROM ai_insights');
  await tx.query('DELETE FROM ai_chat_sessions');
  return entryId;
}
export async function saveEntry(userId: string, input: unknown, id?: string) {
  return asUser(userId, (tx) => writeEntry(tx, userId, input, id));
}
export async function deleteEntry(userId: string, id: string) {
  return asUser(userId, async (tx) => {
    const result = await tx.query(
      'DELETE FROM journal_entries WHERE id=$1 RETURNING candidate_id',
      [id],
    );
    if (!result.length) throw new AppError(404, '日記が見つかりません');
    if (result[0].candidate_id)
      await tx.query("UPDATE extracted_journal_candidates SET status='rejected' WHERE id=$1", [
        result[0].candidate_id,
      ]);
    await tx.query('DELETE FROM ai_insights');
    await tx.query('DELETE FROM ai_chat_sessions');
  });
}
export async function listCandidates(userId: string) {
  return asUser(userId, async (tx) =>
    (
      await tx.query(
        'SELECT c.*,m.sent_at,v.payload AS conversation FROM extracted_journal_candidates c JOIN imported_messages m ON m.id=c.source_message_id JOIN imported_conversations v ON v.id=m.conversation_id ORDER BY m.sent_at DESC NULLS LAST',
      )
    ).map(
      (r) =>
        ({
          ...open<CandidateContent>(r.payload),
          id: r.id,
          source_message_id: r.source_message_id,
          recorded_at: iso(r.sent_at),
          status: r.status,
          conversation_title: open<{ title: string }>(r.conversation).title,
        }) as Candidate,
    ),
  );
}
export async function reviewCandidate(userId: string, id: string, input: unknown, reject = false) {
  return asUser(userId, async (tx) => {
    const [c] = await tx.query(
      'SELECT * FROM extracted_journal_candidates WHERE id=$1 FOR UPDATE',
      [id],
    );
    if (!c) throw new AppError(404, '候補が見つかりません');
    if (reject) {
      await tx.query("UPDATE extracted_journal_candidates SET status='rejected' WHERE id=$1", [id]);
      await tx.query('DELETE FROM journal_entries WHERE candidate_id=$1', [id]);
      await tx.query('DELETE FROM ai_insights');
      await tx.query('DELETE FROM ai_chat_sessions');
      return null;
    }
    const original = open<CandidateContent>(c.payload);
    const v = journalSchema.parse(input);
    // Preserve the AI extraction. Corrections live only in the confirmed journal.
    const [existing] = await tx.query('SELECT id FROM journal_entries WHERE candidate_id=$1', [id]);
    const entry = await writeEntry(tx, userId, v, existing?.id, {
      messageId: c.source_message_id,
      candidateId: id,
    });
    await tx.query("UPDATE extracted_journal_candidates SET status='confirmed' WHERE id=$1", [id]);
    void original;
    return entry;
  });
}
