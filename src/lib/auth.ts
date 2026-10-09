import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, asUser } from './db';
import { hash, passwordHash, passwordMatches } from './crypto';
import { AppError } from './validation';
import { z } from 'zod';
const cookieName = 'iw_session';
const authSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
  name: z.string().max(80).optional(),
});
function supabase() {
  return process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
}
function ensureAuth() {
  if (process.env.DATABASE_URL && !supabase())
    throw new AppError(503, 'Supabase 認証の設定が必要です');
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.INNER_WEATHER_LOCAL !== '1' &&
    !supabase()
  )
    throw new AppError(503, '本番環境では Supabase 認証が必要です');
}
export async function currentUser() {
  ensureAuth();
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (!token) throw new AppError(401, 'ログインしてください');
  const client = supabase();
  if (client) {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user)
      throw new AppError(401, 'セッションの有効期限が切れました。再度ログインしてください');
    return { id: data.user.id, email: data.user.email ?? '' };
  }
  const [user] = await (
    await db()
  ).query(
    'SELECT u.id,u.email FROM local_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at > now()',
    [hash(token)],
  );
  if (!user) throw new AppError(401, '再度ログインしてください');
  return { id: String(user.id), email: String(user.email) };
}
export async function authenticate(input: unknown, register: boolean) {
  ensureAuth();
  const { email, password, name } = authSchema.parse(input);
  const client = supabase();
  let token: string;
  let userId: string;
  const database = await db();
  if (client) {
    const { data, error } = register
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    if (error)
      throw new AppError(400, '認証できませんでした。メールアドレスとパスワードを確認してください');
    if (!data.session || !data.user) return { verifyEmail: true };
    token = data.session.access_token;
    userId = data.user.id;
    await database.query(
      "INSERT INTO users(id,email,auth_kind) VALUES($1,$2,'supabase') ON CONFLICT(id) DO UPDATE SET email=excluded.email",
      [userId, email],
    );
  } else {
    if (register) {
      userId = randomUUID();
      const stored = passwordHash(password);
      try {
        await database.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
          userId,
          email,
          stored,
        ]);
      } catch (e) {
        if ((e as { code: string }).code === '23505')
          throw new AppError(400, '登録できませんでした。既存のアカウントでログインしてください');
        throw e;
      }
    } else {
      const [u] = await database.query('SELECT id,password_hash FROM users WHERE email=$1', [
        email,
      ]);
      const valid = passwordMatches(password, u?.password_hash || passwordHash('dummy-password'));
      if (!u || !valid) throw new AppError(401, 'メールアドレスまたはパスワードを確認してください');
      userId = u.id;
    }
    token = randomBytes(32).toString('hex');
    await database.query(
      "INSERT INTO local_sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [hash(token), userId],
    );
  }
  await asUser(userId, (tx) =>
    tx.query(
      'INSERT INTO profiles(user_id,display_name) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING',
      [userId, name || ''],
    ),
  );
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.INNER_WEATHER_LOCAL !== '1',
    sameSite: 'strict',
    path: '/',
    maxAge: client ? 3600 : 604800,
  });
  return { id: userId, email };
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token && !supabase())
    await (await db()).query('DELETE FROM local_sessions WHERE id=$1', [hash(token)]);
  jar.delete(cookieName);
}
