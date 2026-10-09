import { randomUUID } from 'node:crypto';
import { asUser, iso, day } from './db';
import { open, seal } from './crypto';
import { listEntries } from './journals';
import { answerWithAI, localAnswer } from './ai';
import { AppError } from './validation';
import type { Source, Entry } from './types';
export async function allSources(userId: string): Promise<Source[]> {
  const entries = await listEntries(userId);
  const journals: Source[] = entries.map((e) => ({
    id: e.id,
    date: e.event_date,
    label: '日記',
    text: e.text,
    type: 'journal',
    source_message_id: e.source_message_id ?? undefined,
    context: {
      emotions: e.emotions,
      energy: e.energy,
      stress: e.stress,
      mood: e.mood,
      body: e.body,
      events: e.events,
      insights: e.insights,
      values: e.values,
      trigger: e.trigger,
      success: e.success,
      conflict: e.conflict,
      recovery: e.recovery,
      important: e.important,
      date_kind: e.date_kind,
    },
  }));
  const messages = await asUser(userId, async (tx) =>
    (
      await tx.query(
        "SELECT m.*,c.payload AS conversation FROM imported_messages m JOIN imported_conversations c ON c.id=m.conversation_id WHERE m.role='user' AND m.on_path=true ORDER BY m.sent_at DESC NULLS LAST",
      )
    )
      .map((m) => ({
        id: m.id,
        date: iso(m.sent_at),
        label: open<{ title: string }>(m.conversation).title,
        text: open<{ text: string }>(m.payload).text,
        type: 'message' as const,
        conversation_id: m.conversation_id,
      }))
      .filter((m) => !!m.text),
  );
  return [...journals, ...messages];
}
function terms(s: string) {
  return (
    s
      .toLowerCase()
      .match(/[a-z]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) || []
  ).flatMap((w) =>
    /[a-z]/.test(w)
      ? [w]
      : Array.from({ length: Math.max(1, w.length - 1) }, (_, i) => w.slice(i, i + 2)),
  );
}
export function retrieve(question: string, sources: Source[], now = new Date()): Source[] {
  const explicit = question.match(/(20\d{2})[年/-](\d{1,2})月?/);
  let from: string | null = null,
    to: string | null = null;
  if (explicit) {
    const y = +explicit[1],
      m = +explicit[2];
    if (m >= 1 && m <= 12) {
      from = `${y}-${String(m).padStart(2, '0')}-01`;
      to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    }
  }
  if (/半年前|six months ago/i.test(question)) {
    const target = new Date(now);
    target.setUTCMonth(target.getUTCMonth() - 6);
    from = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    to = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
  }
  const needles = terms(question).filter(
    (t) =>
      ![
        '教え',
        'えて',
        '最近',
        '自分',
        '何に',
        'たと',
        'につ',
        'いて',
        'して',
        '振り',
        'り返',
        '返っ',
        'って',
        'the',
        'was',
        'what',
        'how',
        'my',
        'self',
      ].includes(t),
  );
  const matches = sources
    .filter((s) => !from || (!!s.date && s.date.slice(0, 10) >= from && s.date.slice(0, 10) <= to!))
    .map((s) => ({
      s,
      score: needles.reduce((n, t) => n + (s.text.toLowerCase().includes(t) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || (b.s.date || '').localeCompare(a.s.date || ''));
  const unique = (values: typeof matches) => {
    const seen = new Set<string>();
    return values
      .filter((v) => {
        const key = v.s.source_message_id || v.s.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12)
      .map((v) => v.s);
  };
  if (from) return unique(matches);
  const relevant = matches.filter((v) => v.score > 0);
  if (relevant.length) return unique(relevant);
  return /最近|変化|振り返|review|recent/i.test(question) ? unique(matches) : [];
}
async function allowed(userId: string, method: string, consent: boolean) {
  if (method !== 'openai') return;
  const [p] = await asUser(userId, (tx) => tx.query('SELECT ai_consent FROM profiles'));
  if (!p?.ai_consent || !consent) throw new AppError(403, '外部 AI 送信に明示的に同意してください');
}
export async function reflect(
  userId: string,
  question: string,
  method: 'local' | 'openai',
  consent: boolean,
  sessionId?: string,
) {
  await allowed(userId, method, consent);
  const sources = retrieve(question, await allSources(userId));
  let answer = localAnswer(question, sources),
    refs = sources.slice(0, 4);
  let usage = { input: 0, output: 0, cost: 0 };
  if (method === 'openai' && sources.length) {
    const result = await answerWithAI(question, sources);
    answer = result.data.answer;
    refs = result.data.sources;
    usage = result.usage;
  }
  const id = sessionId || randomUUID();
  await asUser(userId, async (tx) => {
    if (sessionId) {
      const [s] = await tx.query('SELECT id FROM ai_chat_sessions WHERE id=$1', [id]);
      if (!s) throw new AppError(404, '対話が見つかりません');
    } else await tx.query('INSERT INTO ai_chat_sessions(id,user_id) VALUES($1,$2)', [id, userId]);
    await tx.query(
      'INSERT INTO ai_chat_messages(id,user_id,session_id,role,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), userId, id, 'user', seal({ text: question })],
    );
    await tx.query(
      'INSERT INTO ai_chat_messages(id,user_id,session_id,role,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), userId, id, 'assistant', seal({ text: answer, sources: refs, method, usage })],
    );
  });
  return { sessionId: id, answer, sources: refs, method, usage };
}
export async function generateInsight(
  userId: string,
  period: 'week' | 'month',
  from: string,
  to: string,
  method: 'local' | 'openai',
  consent: boolean,
) {
  await allowed(userId, method, consent);
  const entries = (await listEntries(userId)).filter(
    (e) => e.event_date && e.event_date >= from && e.event_date <= to,
  );
  if (!entries.length) throw new AppError(400, '選択した期間に日付が確認された日記がありません');
  const sources: Source[] = entries.slice(0, 10).map(sourceFromEntry);
  const emotionCounts: Record<string, number> = {};
  for (const e of entries)
    for (const k of Object.keys(e.emotions)) emotionCounts[k] = (emotionCounts[k] || 0) + 1;
  // Include at most two earlier user records in the disclosed comparison input.
  const earlier = retrieve(
    entries[0].text,
    (await allSources(userId)).filter((s) => s.date && s.date.slice(0, 10) < from),
  ).slice(0, 2);
  const question = `${from}〜${to}の${period === 'week' ? '週次' : '月次'}振り返り。感情変化、きっかけ、繰り返す思考、価値観、自己理解、回復、セルフコンパッションの気づきを、根拠がある項目だけ整理してください。診断しない。`;
  let answer = `${entries.length}件の日記を振り返ります。\n\n` + localAnswer(question, sources);
  let refs = sources.slice(0, 4);
  let usage = { input: 0, output: 0, cost: 0 };
  if (method === 'openai') {
    const result = await answerWithAI(question, [...sources, ...earlier]);
    answer = result.data.answer;
    refs = result.data.sources;
    usage = result.usage;
  }
  const payload = {
    answer,
    sources: refs,
    similar: earlier,
    emotionCounts,
    usage,
    limitedTo: sources.length + earlier.length,
    method,
  };
  const id = randomUUID();
  await asUser(userId, (tx) =>
    tx.query(
      'INSERT INTO ai_insights(id,user_id,period,range_from,range_to,payload,method) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, userId, period, from, to, seal(payload), method],
    ),
  );
  return { id, period, from, to, ...payload };
}
export async function listInsights(userId: string) {
  return asUser(userId, async (tx) =>
    (await tx.query('SELECT * FROM ai_insights ORDER BY created_at DESC LIMIT 24')).map((i) => ({
      id: i.id,
      period: i.period,
      from: day(i.range_from),
      to: day(i.range_to),
      created_at: iso(i.created_at),
      ...open<Record<string, unknown>>(i.payload),
    })),
  );
}
export async function listChats(userId: string) {
  return asUser(userId, async (tx) =>
    (await tx.query('SELECT * FROM ai_chat_messages ORDER BY created_at ASC LIMIT 300')).map(
      (m) => ({
        id: m.id,
        sessionId: m.session_id,
        role: m.role,
        ...open<Record<string, unknown>>(m.payload),
      }),
    ),
  );
}

function sourceFromEntry(e: Entry): Source {
  return {
    id: e.id,
    date: e.event_date,
    label: '日記',
    text: e.text,
    type: 'journal',
    context: {
      emotions: e.emotions,
      energy: e.energy,
      stress: e.stress,
      mood: e.mood,
      body: e.body,
      events: e.events,
      insights: e.insights,
      values: e.values,
      trigger: e.trigger,
      success: e.success,
      conflict: e.conflict,
      recovery: e.recovery,
      important: e.important,
      date_kind: e.date_kind,
    },
  };
}
