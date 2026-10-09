import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { dataDirectory } from './crypto';
import { databaseError } from './database-errors';
import { databaseSSL } from './database-ssl';
import { AppError } from './validation';
export type Row = Record<string, any>;
export type Tx = { query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]> };
type DB = Tx & { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };
const globals = globalThis as unknown as { weatherDB?: Promise<DB> };
async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw databaseError(error) ?? error;
  }
}
function remoteConnection(url: string) {
  try {
    return postgres(url, {
      max: 5,
      prepare: false,
      ssl: databaseSSL(),
      onnotice: () => {},
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw (
      databaseError(error) ??
      new AppError(
        503,
        '[DB_CONFIG] データベースの接続設定を読み込めません。DATABASE_URLの形式とパスワードのURLエンコードを確認してください',
      )
    );
  }
}
async function connect(): Promise<DB> {
  if (process.env.DATABASE_URL) {
    const pg = remoteConnection(process.env.DATABASE_URL);
    const wrap = (q: any): Tx => ({
      query: (sql, params = []) =>
        databaseOperation(async () => Array.from(await q.unsafe(sql, params)) as any),
    });
    return {
      ...wrap(pg),
      transaction: (fn) =>
        databaseOperation(async () => pg.begin(async (tx) => fn(wrap(tx))) as any),
    };
  }
  if (process.env.NODE_ENV === 'production' && process.env.INNER_WEATHER_LOCAL !== '1')
    throw new Error('Production requires DATABASE_URL and Supabase Auth');
  const location =
    process.env.INNER_WEATHER_DB === 'memory' ? undefined : path.join(dataDirectory(), 'postgres');
  if (location) await mkdir(location, { recursive: true, mode: 0o700 });
  const pg = new PGlite(location);
  await pg.waitReady;
  await pg.exec(
    await readFile(path.join(process.cwd(), 'supabase/migrations/001_inner_weather.sql'), 'utf8'),
  );
  const wrap = (q: any): Tx => ({
    query: (sql, params = []) => databaseOperation(async () => (await q.query(sql, params)).rows),
  });
  return {
    ...wrap(pg),
    transaction: (fn) => databaseOperation(() => pg.transaction((tx) => fn(wrap(tx)))),
  };
}
export function db() {
  return (globals.weatherDB ??= databaseOperation(connect));
}
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>) {
  return (await db()).transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [userId]);
    await tx.query('SET LOCAL ROLE authenticated');
    return fn(tx);
  });
}
export function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
export function day(value: unknown): string | null {
  return iso(value)?.slice(0, 10) ?? null;
}
