import { asUser, db, iso } from './db';
import { open } from './crypto';
import { AppError } from './validation';
import { UPLOAD_MB } from './import-parser';
export async function getProfile(userId: string) {
  const [p] = await asUser(userId, (tx) => tx.query('SELECT * FROM profiles'));
  return {
    uploadLimitMb: UPLOAD_MB,
    timezone: String(p?.timezone || 'Asia/Tokyo'),
    display_name: String(p?.display_name || ''),
    ai_consent: !!p?.ai_consent,
    consent_at: iso(p?.consent_at),
    aiAvailable: !!(process.env.OPENAI_API_KEY || process.env.IW_OPENAI_API_KEY),
    authProvider: process.env.SUPABASE_URL ? 'supabase' : 'local',
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  };
}
export async function getConversation(userId: string, id: string) {
  return asUser(userId, async (tx) => {
    const [c] = await tx.query('SELECT * FROM imported_conversations WHERE id=$1', [id]);
    if (!c) throw new AppError(404, '会話が見つかりません');
    const messages = (
      await tx.query(
        'SELECT * FROM imported_messages WHERE conversation_id=$1 ORDER BY sent_at ASC NULLS FIRST',
        [id],
      )
    ).map((m) => ({
      id: m.id,
      external_id: m.external_id,
      parent: m.parent_external_id,
      children: m.children,
      role: m.role,
      sent_at: iso(m.sent_at),
      on_path: m.on_path,
      ...open<Record<string, unknown>>(m.payload),
    }));
    return {
      id: c.id,
      external_id: c.external_id,
      created_at: iso(c.created_at),
      ...open<Record<string, unknown>>(c.payload),
      messages: orderMessages(messages),
    };
  });
}
export async function listConversations(userId: string) {
  return asUser(userId, async (tx) =>
    (
      await tx.query(
        'SELECT c.*,count(m.id)::int AS messages FROM imported_conversations c LEFT JOIN imported_messages m ON m.conversation_id=c.id GROUP BY c.id ORDER BY c.created_at DESC NULLS LAST',
      )
    ).map((c) => ({
      id: c.id,
      external_id: c.external_id,
      created_at: iso(c.created_at),
      messages: c.messages,
      ...open<{ title: string }>(c.payload),
    })),
  );
}
export async function getMessage(userId: string, id: string) {
  const [m] = await asUser(userId, (tx) =>
    tx.query('SELECT conversation_id FROM imported_messages WHERE id=$1', [id]),
  );
  if (!m) throw new AppError(404, '原文が見つかりません');
  return getConversation(userId, m.conversation_id);
}
export async function exportData(userId: string) {
  return asUser(userId, async (tx) => {
    const tables = [
      'profiles',
      'journal_entries',
      'emotion_scores',
      'anchors',
      'imported_conversations',
      'imported_messages',
      'import_jobs',
      'import_job_conversations',
      'import_job_messages',
      'import_job_items',
      'extracted_journal_candidates',
      'ai_insights',
      'ai_chat_sessions',
      'ai_chat_messages',
    ];
    const data: Record<string, unknown> = { version: 1, exported_at: new Date().toISOString() };
    for (const table of tables)
      data[table] = (await tx.query(`SELECT * FROM ${table}`)).map((row) => {
        const r = { ...row };
        if (r.payload) {
          r.content = open(r.payload);
          delete r.payload;
        }
        if (r.staging_payload) {
          r.staging_source = open(r.staging_payload);
          delete r.staging_payload;
        }
        delete r.lease_token;
        return r;
      });
    return data;
  });
}
export async function deleteAllData(userId: string) {
  return asUser(userId, async (tx) => {
    for (const table of [
      'ai_chat_sessions',
      'ai_insights',
      'import_jobs',
      'imported_conversations',
      'journal_entries',
    ])
      await tx.query(`DELETE FROM ${table}`);
    await tx.query('UPDATE profiles SET ai_consent=false,consent_at=null');
  });
}
export async function deleteAccount(userId: string) {
  // Delete Supabase Auth identity as well as app data. Never leave a hidden external identity.
  if (process.env.SUPABASE_URL) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      throw new AppError(
        503,
        'アカウント完全削除には管理者の Supabase Admin API 設定が必要です。記録はデータ削除から消去できます',
      );
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!response.ok) throw new AppError(502, '認証アカウントを削除できませんでした');
  }
  await (await db()).query('DELETE FROM users WHERE id=$1', [userId]);
}

export function orderMessages<
  T extends { id: string; parent: string | null; on_path: boolean; metadata?: any },
>(messages: T[]): T[] {
  const nodeId = (m: T) => String(m.metadata?.node_id || m.id);
  const known = new Set(messages.map(nodeId));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const m of messages) {
    if (!m.parent || !known.has(m.parent)) roots.push(m);
    else {
      const list = children.get(m.parent) || [];
      list.push(m);
      children.set(m.parent, list);
    }
  }
  const byPath = (a: T, b: T) => Number(b.on_path) - Number(a.on_path);
  roots.sort(byPath);
  for (const list of children.values()) list.sort(byPath);
  const ordered: T[] = [],
    visited = new Set<string>();
  const stack = [...roots].reverse();
  while (stack.length) {
    const m = stack.pop()!;
    if (visited.has(m.id)) continue;
    visited.add(m.id);
    ordered.push(m);
    stack.push(...(children.get(nodeId(m)) || []).slice().reverse());
  }
  // Broken or cyclic nodes are retained after the well-formed tree.
  for (const m of messages) if (!visited.has(m.id)) ordered.push(m);
  return ordered;
}
