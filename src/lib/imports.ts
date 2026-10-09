import { randomUUID } from 'node:crypto';
import { asUser, db, type Tx, iso } from './db';
import { seal, open, hash } from './crypto';
import { parseExport, isRelevant, splitMessage, estimateCost } from './import-parser';
import { localExtract, extractWithAI, AIUsageError, type Usage } from './ai';
import { AppError } from './validation';
import type { CandidateContent, ImportJob } from './types';
export async function createImport(
  userId: string,
  parsed: ReturnType<typeof parseExport>,
  selected: string[],
  method: 'local' | 'openai',
  consent: boolean,
) {
  if (!selected.length || selected.some((id) => !parsed.conversations.some((c) => c.id === id)))
    throw new AppError(400, '会話を選択してください');
  const conversations = parsed.conversations.filter((c) => selected.includes(c.id));
  return asUser(userId, async (tx) => {
    if (method === 'openai') {
      const [p] = await tx.query('SELECT ai_consent FROM profiles');
      if (!consent || !p?.ai_consent)
        throw new AppError(403, '設定とインポート画面で外部 AI 送信に同意してください');
      if (!(process.env.OPENAI_API_KEY || process.env.IW_OPENAI_API_KEY))
        throw new AppError(503, 'OpenAI API が未設定です');
    }
    const messageTotal = conversations.reduce((n, c) => n + c.messages.length, 0);
    if (messageTotal > 200) {
      const id = randomUUID();
      await tx.query(
        'INSERT INTO import_jobs(id,user_id,fingerprint,status,method,consent_at,stage,staging_payload,ingest_total,warnings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id,
          userId,
          parsed.fingerprint,
          'queued',
          method,
          consent ? new Date().toISOString() : null,
          'ingest',
          seal(conversations),
          messageTotal,
          JSON.stringify(parsed.warnings),
        ],
      );
      return { id, added: 0, duplicates: 0, total: 0, ingestTotal: messageTotal };
    }
    // Account-scoped lock serializes imports; unique IDs remain the final integrity guard.
    await tx.query('SELECT user_id FROM profiles WHERE user_id=$1 FOR UPDATE', [userId]);
    const job = randomUUID();
    const warnings = [...parsed.warnings];
    await tx.query(
      'INSERT INTO import_jobs(id,user_id,fingerprint,status,method,consent_at) VALUES($1,$2,$3,$4,$5,$6)',
      [
        job,
        userId,
        parsed.fingerprint,
        'queued',
        method,
        consent ? new Date().toISOString() : null,
      ],
    );
    let added = 0,
      duplicates = 0,
      total = 0;
    for (const c of conversations) {
      let [conv] = await tx.query('SELECT id FROM imported_conversations WHERE external_id=$1', [
        c.id,
      ]);
      if (!conv) {
        [conv] = await tx.query(
          'INSERT INTO imported_conversations(id,user_id,external_id,payload,created_at,updated_at,current_node) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [
            randomUUID(),
            userId,
            c.id,
            seal({ title: c.title, metadata: c.metadata }),
            c.created_at,
            c.updated_at,
            c.current_node,
          ],
        );
      }
      await tx.query(
        'INSERT INTO import_job_conversations(user_id,job_id,conversation_id) VALUES($1,$2,$3)',
        [userId, job, conv.id],
      );
      // Retain each export's branch selection without replacing original message text.
      await tx.query('UPDATE imported_messages SET on_path=false WHERE conversation_id=$1', [
        conv.id,
      ]);
      for (const m of c.messages) {
        let [msg] = await tx.query(
          'SELECT id,content_hash FROM imported_messages WHERE conversation_id=$1 AND external_id=$2',
          [conv.id, m.id],
        );
        if (msg) {
          duplicates++;
          if (msg.content_hash !== hash(m.text))
            warnings.push('同じメッセージIDで本文の差異を検出しました。最初の原文を保持しました');
          await tx.query('UPDATE imported_messages SET on_path=$1 WHERE id=$2', [
            m.on_path,
            msg.id,
          ]);
        } else {
          [msg] = await tx.query(
            'INSERT INTO imported_messages(id,user_id,conversation_id,external_id,parent_external_id,children,role,sent_at,on_path,payload,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
            [
              randomUUID(),
              userId,
              conv.id,
              m.id,
              m.parent,
              JSON.stringify(m.children),
              m.role,
              m.timestamp,
              m.on_path,
              seal({ text: m.text, metadata: m.metadata }),
              hash(m.text),
            ],
          );
          added++;
        }
        await tx.query(
          'INSERT INTO import_job_messages(user_id,job_id,message_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [userId, job, msg.id],
        );
        if (m.role !== 'user' || !m.on_path || !isRelevant(m.text)) continue;
        const chunks = splitMessage(m.text);
        for (let i = 0; i < chunks.length; i++) {
          const [existing] = await tx.query(
            'SELECT id FROM extracted_journal_candidates WHERE source_message_id=$1 AND chunk_index=$2',
            [msg.id, i],
          );
          if (existing) continue;
          // If an existing ID has changed, extract from the preserved original instead.
          const [stored] = await tx.query('SELECT payload FROM imported_messages WHERE id=$1', [
            msg.id,
          ]);
          const canonical = open<{ text: string }>(stored.payload).text;
          const chunk = splitMessage(canonical)[i];
          if (!chunk) continue;
          await tx.query(
            'INSERT INTO import_job_items(id,user_id,job_id,message_id,chunk_index,payload) VALUES($1,$2,$3,$4,$5,$6)',
            [randomUUID(), userId, job, msg.id, i, seal(chunk)],
          );
          total++;
        }
      }
    }
    await tx.query(
      'UPDATE import_jobs SET total=$1,status=$2,warnings=$3,added=$5,duplicates=$6 WHERE id=$4',
      [
        total,
        total ? 'queued' : 'completed',
        JSON.stringify(warnings.slice(0, 100)),
        job,
        added,
        duplicates,
      ],
    );
    return { id: job, added, duplicates, total };
  });
}
export async function listJobs(userId: string): Promise<ImportJob[]> {
  return asUser(userId, async (tx) =>
    (await tx.query('SELECT * FROM import_jobs ORDER BY created_at DESC')).map((r) => ({
      stage: r.stage,
      ingest_cursor: r.ingest_cursor,
      ingest_total: r.ingest_total,
      added: r.added,
      duplicates: r.duplicates,
      id: r.id,
      fingerprint: r.fingerprint,
      status: r.status,
      method: r.method,
      total: r.total,
      processed: r.processed,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cost_usd: r.cost_usd,
      error: r.error,
      created_at: iso(r.created_at)!,
      consent_at: iso(r.consent_at),
      lease_until: iso(r.lease_until),
      warnings: JSON.parse(r.warnings),
    })),
  );
}
export async function controlJob(userId: string, id: string, action: 'pause' | 'resume') {
  return asUser(userId, async (tx) => {
    const [j] = await tx.query('SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE', [id]);
    if (!j) throw new AppError(404, 'インポートが見つかりません');
    if (j.status === 'completed') return;
    if (action === 'pause')
      await tx.query("UPDATE import_jobs SET status='paused' WHERE id=$1", [id]);
    else {
      if (j.lease_until && new Date(j.lease_until).getTime() > Date.now())
        throw new AppError(409, '処理中の通信が完了してから再開してください');
      await tx.query(
        "UPDATE import_job_items SET status='pending',attempts=0,error=null,next_attempt_at=null WHERE job_id=$1 AND status='failed'",
        [id],
      );
      await tx.query(
        "UPDATE import_jobs SET status='queued',error=null,lease_until=null,lease_token=null WHERE id=$1",
        [id],
      );
    }
  });
}
export async function processJob(userId: string, id: string) {
  const token = randomUUID();
  const claimed = await asUser(userId, async (tx) => {
    const [j] = await tx.query(
      "UPDATE import_jobs SET status='running',lease_until=now()+interval '60 seconds',lease_token=$2 WHERE id=$1 AND status IN ('queued','running') AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
      [id, token],
    );
    if (!j) return null;
    if (j.method === 'openai') {
      const [p] = await tx.query('SELECT ai_consent FROM profiles');
      if (!p?.ai_consent) {
        await tx.query(
          "UPDATE import_jobs SET status='paused',error=$1,lease_until=null,lease_token=null WHERE id=$2",
          ['AI送信の同意が取り消されました', id],
        );
        return null;
      }
    }
    if (j.stage === 'ingest') {
      await ingestBatch(tx, userId, j);
      return null;
    }
    const [item] = await tx.query(
      "SELECT i.*,m.sent_at FROM import_job_items i JOIN imported_messages m ON m.id=i.message_id WHERE i.job_id=$1 AND i.status='pending' AND (i.next_attempt_at IS NULL OR i.next_attempt_at<=now()) ORDER BY i.id LIMIT 1",
      [id],
    );
    if (!item) {
      const [waiting] = await tx.query(
        "SELECT id FROM import_job_items WHERE job_id=$1 AND status='pending' LIMIT 1",
        [id],
      );
      const [f] = await tx.query(
        "SELECT id FROM import_job_items WHERE job_id=$1 AND status='failed' LIMIT 1",
        [id],
      );
      await tx.query(
        'UPDATE import_jobs SET status=$1,lease_until=null,lease_token=null WHERE id=$2',
        [waiting ? 'queued' : f ? 'failed' : 'completed', id],
      );
      return null;
    }
    const text = open<string>(item.payload);
    if (
      j.method === 'openai' &&
      Number(j.cost_usd) + estimateCost(text.length * 2 + 1200, 2200) >
        Number(process.env.AI_JOB_BUDGET_USD || 1)
    ) {
      await tx.query(
        "UPDATE import_jobs SET status='paused',error=$1,lease_until=null,lease_token=null WHERE id=$2",
        ['ジョブの費用上限に達しました。管理者が予算設定を見直すまで外部送信を停止します', id],
      );
      return null;
    }
    return { job: j, item, text };
  });
  if (!claimed) return;
  let data: CandidateContent | undefined;
  let usage: Usage = { input: 0, output: 0, cost: 0 };
  let error: string | null = null;
  try {
    if (claimed.job.method === 'openai') {
      const result = await extractWithAI(claimed.text, iso(claimed.item.sent_at));
      data = result.data;
      usage = result.usage;
    } else data = localExtract(claimed.text, iso(claimed.item.sent_at));
  } catch (e) {
    if (e instanceof AIUsageError) usage = e.usage;
    error = e instanceof AppError ? e.message : '抽出を完了できませんでした。再試行できます';
  }
  await asUser(userId, async (tx) => {
    const [j] = await tx.query(
      'SELECT * FROM import_jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE',
      [id, token],
    );
    if (!j) return;
    await tx.query(
      'UPDATE import_jobs SET input_tokens=input_tokens+$1,output_tokens=output_tokens+$2,cost_usd=cost_usd+$3 WHERE id=$4',
      [usage.input, usage.output, usage.cost, id],
    );
    if (j.status === 'paused') {
      await tx.query('UPDATE import_jobs SET lease_until=null,lease_token=null WHERE id=$1', [id]);
      return;
    }
    if (error) {
      const attempts = claimed.item.attempts + 1;
      await tx.query(
        "UPDATE import_job_items SET attempts=$1,status=$2,error=$3,next_attempt_at=now()+($5::text || ' seconds')::interval WHERE id=$4",
        [
          attempts,
          attempts >= 3 ? 'failed' : 'pending',
          error,
          claimed.item.id,
          Math.min(60, 5 * 2 ** (attempts - 1)),
        ],
      );
      await tx.query(
        'UPDATE import_jobs SET status=$1,error=$2,lease_until=null,lease_token=null WHERE id=$3',
        [attempts >= 3 ? 'failed' : 'queued', error, id],
      );
      return;
    }
    // Unique source/chunk prevents double candidates across repeated or competing jobs.
    await tx.query(
      'INSERT INTO extracted_journal_candidates(id,user_id,source_message_id,chunk_index,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,source_message_id,chunk_index) DO NOTHING',
      [randomUUID(), userId, claimed.item.message_id, claimed.item.chunk_index, seal(data)],
    );
    await tx.query("UPDATE import_job_items SET status='done',error=null WHERE id=$1", [
      claimed.item.id,
    ]);
    const [pending] = await tx.query(
      "SELECT count(*)::int AS n FROM import_job_items WHERE job_id=$1 AND status='pending'",
      [id],
    );
    await tx.query(
      'UPDATE import_jobs SET processed=processed+1,status=$1,error=null,lease_until=null,lease_token=null WHERE id=$2',
      [pending.n ? 'queued' : 'completed', id],
    );
  });
}
export async function deleteImport(userId: string, id: string) {
  return asUser(userId, async (tx) => {
    const [j] = await tx.query('SELECT id FROM import_jobs WHERE id=$1 FOR UPDATE', [id]);
    if (!j) throw new AppError(404, 'インポートが見つかりません');
    await tx.query('DELETE FROM import_jobs WHERE id=$1', [id]);
    // Shared provenance survives deletion of one import. Only orphaned sources cascade.
    await tx.query(
      'DELETE FROM imported_messages m WHERE NOT EXISTS(SELECT 1 FROM import_job_messages l WHERE l.message_id=m.id)',
    );
    await tx.query(
      'DELETE FROM imported_conversations c WHERE NOT EXISTS(SELECT 1 FROM import_job_conversations l WHERE l.conversation_id=c.id)',
    );
    await tx.query('DELETE FROM ai_insights');
    await tx.query('DELETE FROM ai_chat_sessions');
  });
}
export async function runWorkerTick(limit = 4) {
  const jobs = await (
    await db()
  ).query(
    "SELECT id,user_id FROM import_jobs WHERE status IN ('queued','running') AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT $1",
    [limit],
  );
  for (const j of jobs) await processJob(j.user_id, j.id);
  return jobs.length;
}

async function ingestBatch(tx: Tx, userId: string, job: any) {
  const conversations = open<ReturnType<typeof parseExport>['conversations']>(job.staging_payload);
  const flat = conversations.flatMap((c) => c.messages.map((m, i) => ({ c, m, first: i === 0 })));
  const batch = flat.slice(job.ingest_cursor, job.ingest_cursor + 25);
  let added = 0,
    duplicates = 0,
    items = 0;
  const warnings = JSON.parse(job.warnings) as string[];
  // Serialize the canonical-source insertion against other jobs for this account.
  await tx.query('SELECT user_id FROM profiles WHERE user_id=$1 FOR UPDATE', [userId]);
  for (const { c, m, first } of batch) {
    let [conv] = await tx.query('SELECT id FROM imported_conversations WHERE external_id=$1', [
      c.id,
    ]);
    if (!conv) {
      [conv] = await tx.query(
        'INSERT INTO imported_conversations(id,user_id,external_id,payload,created_at,updated_at,current_node) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [
          randomUUID(),
          userId,
          c.id,
          seal({ title: c.title, metadata: c.metadata }),
          c.created_at,
          c.updated_at,
          c.current_node,
        ],
      );
    }
    await tx.query(
      'INSERT INTO import_job_conversations(user_id,job_id,conversation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [userId, job.id, conv.id],
    );
    if (first)
      await tx.query('UPDATE imported_messages SET on_path=false WHERE conversation_id=$1', [
        conv.id,
      ]);
    let [msg] = await tx.query(
      'SELECT id,content_hash,payload FROM imported_messages WHERE conversation_id=$1 AND external_id=$2',
      [conv.id, m.id],
    );
    let canonical = m.text;
    if (msg) {
      duplicates++;
      canonical = open<{ text: string }>(msg.payload).text;
      if (msg.content_hash !== hash(m.text) && warnings.length < 100)
        warnings.push('同じメッセージIDの本文差異を検出しました。最初の原文を保持しました');
      await tx.query('UPDATE imported_messages SET on_path=$1 WHERE id=$2', [m.on_path, msg.id]);
    } else {
      [msg] = await tx.query(
        'INSERT INTO imported_messages(id,user_id,conversation_id,external_id,parent_external_id,children,role,sent_at,on_path,payload,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
        [
          randomUUID(),
          userId,
          conv.id,
          m.id,
          m.parent,
          JSON.stringify(m.children),
          m.role,
          m.timestamp,
          m.on_path,
          seal({ text: m.text, metadata: m.metadata }),
          hash(m.text),
        ],
      );
      added++;
    }
    await tx.query(
      'INSERT INTO import_job_messages(user_id,job_id,message_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [userId, job.id, msg.id],
    );
    if (m.role !== 'user' || !m.on_path || !isRelevant(canonical)) continue;
    const chunks = splitMessage(canonical);
    for (let i = 0; i < chunks.length; i++) {
      const [existing] = await tx.query(
        'SELECT id FROM extracted_journal_candidates WHERE source_message_id=$1 AND chunk_index=$2',
        [msg.id, i],
      );
      if (existing) continue;
      const inserted = await tx.query(
        'INSERT INTO import_job_items(id,user_id,job_id,message_id,chunk_index,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',
        [randomUUID(), userId, job.id, msg.id, i, seal(chunks[i])],
      );
      items += inserted.length;
    }
  }
  const cursor = job.ingest_cursor + batch.length,
    done = cursor >= flat.length;
  await tx.query(
    'UPDATE import_jobs SET ingest_cursor=$1,added=added+$2,duplicates=duplicates+$3,total=total+$4,stage=$5,status=$6,staging_payload=CASE WHEN $7 THEN null ELSE staging_payload END,warnings=$8,lease_until=null,lease_token=null WHERE id=$9',
    [
      cursor,
      added,
      duplicates,
      items,
      done ? 'extract' : 'ingest',
      done && job.total + items === 0 ? 'completed' : 'queued',
      done,
      JSON.stringify(warnings),
      job.id,
    ],
  );
}
