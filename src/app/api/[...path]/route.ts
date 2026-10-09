import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { currentUser, authenticate, logout } from '@/lib/auth';
import { AppError, uuidSchema, dateOnly } from '@/lib/validation';
import { assertRequestOrigin } from '@/lib/request-origin';
import { asUser } from '@/lib/db';
import {
  listEntries,
  saveEntry,
  deleteEntry,
  listCandidates,
  reviewCandidate,
} from '@/lib/journals';
import { parseExport, previewExport, MAX_UPLOAD } from '@/lib/import-parser';
import {
  createImport,
  listJobs,
  controlJob,
  processJob,
  deleteImport,
  runWorkerTick,
} from '@/lib/imports';
import {
  getProfile,
  listConversations,
  getConversation,
  getMessage,
  exportData,
  deleteAllData,
  deleteAccount,
} from '@/lib/data';
import {
  reflect,
  generateInsight,
  listInsights,
  listChats,
  allSources,
  retrieve,
} from '@/lib/reflect';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const globals = globalThis as unknown as { iwRate?: Map<string, { n: number; reset: number }> };
function rate(key: string, max = 180) {
  const map = (globals.iwRate ??= new Map());
  const now = Date.now();
  if (map.size > 10000) for (const [k, v] of map) if (v.reset < now) map.delete(k);
  const v = map.get(key);
  if (!v || v.reset < now) {
    map.set(key, { n: 1, reset: now + 60000 });
    return;
  }
  if (++v.n > max) throw new AppError(429, '少し時間をおいてからお試しください');
}
async function bounded(req: NextRequest, max: number) {
  if (Number(req.headers.get('content-length') || 0) > max)
    throw new AppError(413, 'ファイルまたは入力が大きすぎます');
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, 'ファイルまたは入力が大きすぎます');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
async function json(req: NextRequest) {
  try {
    return JSON.parse(new TextDecoder().decode(await bounded(req, 128 * 1024)));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, 'JSON が不正です');
  }
}
async function form(req: NextRequest, max = MAX_UPLOAD + 1024 * 1024) {
  const bytes = await bounded(req, max);
  try {
    return await new Request(req.url, {
      method: 'POST',
      headers: { 'Content-Type': req.headers.get('content-type') || '' },
      body: bytes,
    }).formData();
  } catch {
    throw new AppError(400, 'アップロードの形式が不正です');
  }
}
function ok(data: unknown) {
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await params;
    const route = path.join('/');
    if (route === 'worker' && req.method === 'POST') {
      const configured = process.env.WORKER_SECRET;
      const supplied = req.headers.get('authorization')?.replace(/^Bearer /, '') || '';
      if (
        !configured ||
        configured.length < 32 ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(configured) ||
        !timingSafeEqual(Buffer.from(configured), Buffer.from(supplied))
      )
        throw new AppError(401, '認証が必要です');
      return ok({ processed: await runWorkerTick(1) });
    }
    assertRequestOrigin(req);
    if (['auth/login', 'auth/register'].includes(route) && req.method === 'POST') {
      rate('auth:' + (req.headers.get('x-forwarded-for')?.split(',')[0] || 'local'), 10);
      return ok(await authenticate(await json(req), route.endsWith('register')));
    }
    if (route === 'auth/logout' && req.method === 'POST') {
      await logout();
      return ok({ ok: true });
    }
    const user = await currentUser();
    rate(user.id);
    const id = path[1];
    if (
      id &&
      id !== 'preview' &&
      ['journals', 'candidates', 'imports', 'conversations', 'messages'].includes(path[0])
    )
      uuidSchema.parse(id);
    if (route === 'me' && req.method === 'GET')
      return ok({ user, profile: await getProfile(user.id) });
    if (route === 'profile' && req.method === 'PATCH') {
      const v = z
        .object({
          timezone: z.string().refine((s) => {
            try {
              new Intl.DateTimeFormat('ja', { timeZone: s });
              return true;
            } catch {
              return false;
            }
          }),
          display_name: z.string().max(80),
          ai_consent: z.boolean(),
        })
        .parse(await json(req));
      await asUser(user.id, (tx) =>
        tx.query(
          'UPDATE profiles SET timezone=$1,display_name=$2,ai_consent=$3,consent_at=CASE WHEN $3 THEN now() ELSE null END',
          [v.timezone, v.display_name, v.ai_consent],
        ),
      );
      if (!v.ai_consent)
        await asUser(user.id, (tx) =>
          tx.query(
            "UPDATE import_jobs SET status='paused',error='AI送信の同意が取り消されました' WHERE method='openai' AND status IN ('queued','running')",
          ),
        );
      return ok(await getProfile(user.id));
    }
    if (route === 'journals' && req.method === 'GET') return ok(await listEntries(user.id));
    if (route === 'journals' && req.method === 'POST')
      return ok({ id: await saveEntry(user.id, await json(req)) });
    if (path[0] === 'journals' && id && req.method === 'PATCH')
      return ok({ id: await saveEntry(user.id, await json(req), id) });
    if (path[0] === 'journals' && id && req.method === 'DELETE') {
      await deleteEntry(user.id, id);
      return ok({ ok: true });
    }
    if (route === 'candidates' && req.method === 'GET') return ok(await listCandidates(user.id));
    if (path[0] === 'candidates' && id && req.method === 'POST') {
      const body = await json(req);
      return ok({ id: await reviewCandidate(user.id, id, body.entry, body.action === 'reject') });
    }
    if (route === 'imports/preview' && req.method === 'POST') {
      const data = await form(req);
      const file = data.get('file');
      if (!(file instanceof File)) throw new AppError(400, 'ファイルを選択してください');
      return ok(previewExport(parseExport(new Uint8Array(await file.arrayBuffer()), file.name)));
    }
    if (route === 'imports' && req.method === 'GET') return ok(await listJobs(user.id));
    if (route === 'imports' && req.method === 'POST') {
      const data = await form(req);
      const file = data.get('file');
      if (!(file instanceof File)) throw new AppError(400, 'ファイルを選択してください');
      if (data.get('confirmed') !== 'true')
        throw new AppError(400, 'インポート開始前の確認が必要です');
      const selected = z
        .array(z.string().max(200))
        .min(1)
        .max(10000)
        .parse(JSON.parse(String(data.get('selected') || '[]')));
      const method = z.enum(['local', 'openai']).parse(data.get('method'));
      return ok(
        await createImport(
          user.id,
          parseExport(new Uint8Array(await file.arrayBuffer()), file.name),
          selected,
          method,
          data.get('aiConsent') === 'true',
        ),
      );
    }
    if (path[0] === 'imports' && id && req.method === 'POST') {
      if (path[2] === 'step') {
        rate('step:' + user.id, 30);
        await processJob(user.id, id);
      } else {
        const v = z.object({ action: z.enum(['pause', 'resume']) }).parse(await json(req));
        await controlJob(user.id, id, v.action);
      }
      return ok(await listJobs(user.id));
    }
    if (path[0] === 'imports' && id && req.method === 'DELETE') {
      await deleteImport(user.id, id);
      return ok({ ok: true });
    }
    if (route === 'conversations' && req.method === 'GET')
      return ok(await listConversations(user.id));
    if (path[0] === 'conversations' && id && req.method === 'GET')
      return ok(await getConversation(user.id, id));
    if (path[0] === 'messages' && id && req.method === 'GET')
      return ok(await getMessage(user.id, id));
    if (route === 'search' && req.method === 'GET') {
      const q = z.string().min(1).max(1000).parse(req.nextUrl.searchParams.get('q'));
      return ok(retrieve(q, await allSources(user.id)));
    }
    if (route === 'insights' && req.method === 'GET') return ok(await listInsights(user.id));
    if (route === 'insights' && req.method === 'POST') {
      rate('ai:' + user.id, 10);
      const v = z
        .object({
          period: z.enum(['week', 'month']),
          from: dateOnly,
          to: dateOnly,
          method: z.enum(['local', 'openai']),
          consent: z.boolean(),
        })
        .refine((v) => v.from <= v.to)
        .parse(await json(req));
      return ok(await generateInsight(user.id, v.period, v.from, v.to, v.method, v.consent));
    }
    if (route === 'reflect' && req.method === 'GET') return ok(await listChats(user.id));
    if (route === 'reflect' && req.method === 'POST') {
      rate('ai:' + user.id, 10);
      const v = z
        .object({
          question: z.string().trim().min(1).max(2000),
          method: z.enum(['local', 'openai']),
          consent: z.boolean(),
          sessionId: z.uuid().optional(),
        })
        .parse(await json(req));
      return ok(await reflect(user.id, v.question, v.method, v.consent, v.sessionId));
    }
    if (route === 'transcribe' && req.method === 'POST') {
      rate('ai:' + user.id, 10);
      const audioLimit = Math.min(11 * 1024 * 1024, MAX_UPLOAD);
      const data = await form(req, audioLimit + 128 * 1024);
      const profile = await getProfile(user.id);
      if (data.get('consent') !== 'true' || !profile.ai_consent)
        throw new AppError(403, '音声の外部送信に同意してください');
      if (!(process.env.OPENAI_API_KEY || process.env.IW_OPENAI_API_KEY))
        throw new AppError(503, 'OpenAI API が未設定です');
      const file = data.get('file');
      if (
        !(file instanceof File) ||
        !['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg'].includes(
          file.type.split(';')[0],
        )
      )
        throw new AppError(400, '対応する音声ファイルを選択してください');
      if (file.size > audioLimit) throw new AppError(413, '音声ファイルが大きすぎます');
      const body = new FormData();
      body.append('model', 'whisper-1');
      body.append('file', file, 'recording.' + (file.type.includes('mp4') ? 'm4a' : 'webm'));
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY || process.env.IW_OPENAI_API_KEY}`,
        },
        body,
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new AppError(502, '文字起こしを完了できませんでした');
      const result = await response.json();
      return ok({ text: z.string().max(30000).parse(result.text) });
    }
    if (route === 'data/export' && req.method === 'GET')
      return new NextResponse(JSON.stringify(await exportData(user.id), null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="inner-weather-export.json"',
          'Cache-Control': 'no-store',
        },
      });
    if (route === 'data' && req.method === 'DELETE') {
      const b = await json(req);
      if (b.confirm !== 'DELETE') throw new AppError(400, '削除の確認が必要です');
      await deleteAllData(user.id);
      return ok({ ok: true });
    }
    if (route === 'account' && req.method === 'DELETE') {
      const b = await json(req);
      if (b.confirm !== 'DELETE') throw new AppError(400, '削除の確認が必要です');
      await deleteAccount(user.id);
      await logout();
      return ok({ ok: true });
    }
    throw new AppError(404, '見つかりません');
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: '入力を確認してください',
          details: e.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400 },
      );
    console.error('Inner Weather request failed:', e instanceof Error ? e.name : 'UnknownError');
    return NextResponse.json(
      { error: '処理を完了できませんでした。設定と接続を確認してください' },
      { status: 500 },
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
