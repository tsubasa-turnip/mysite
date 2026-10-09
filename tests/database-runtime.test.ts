import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { asUser, db } from '../src/lib/db';
import { AppError } from '../src/lib/validation';

const { postgresMock, remoteUnsafe, transactionUnsafe, begin } = vi.hoisted(() => ({
  postgresMock: vi.fn(),
  remoteUnsafe: vi.fn(),
  transactionUnsafe: vi.fn(),
  begin: vi.fn(),
}));

vi.mock('postgres', () => ({ default: postgresMock }));

const globals = globalThis as unknown as { weatherDB?: ReturnType<typeof db> };
const syntheticUrl =
  'postgres://synthetic-user:synthetic-password@database.example.test/app?sslmode=require';

describe('database runtime failure handling', () => {
  beforeEach(() => {
    delete globals.weatherDB;
    vi.stubEnv('DATABASE_URL', syntheticUrl);
    vi.stubEnv('DATABASE_SSL_CA_FILE', undefined);
    vi.stubEnv('DATABASE_SSL_CA', undefined);
    remoteUnsafe.mockReset().mockResolvedValue([]);
    transactionUnsafe.mockReset().mockResolvedValue([]);
    begin
      .mockReset()
      .mockImplementation(async (callback) => callback({ unsafe: transactionUnsafe }));
    postgresMock.mockReset().mockReturnValue({ unsafe: remoteUnsafe, begin });
  });

  afterEach(() => {
    delete globals.weatherDB;
    vi.unstubAllEnvs();
  });

  it('maps a remote query TLS failure without leaking provider details', async () => {
    const privateText = 'private-provider-message synthetic-password';
    remoteUnsafe.mockRejectedValue(
      Object.assign(new Error(privateText), {
        code: 'SELF_SIGNED_CERT_IN_CHAIN',
        detail: privateText,
        query: 'SELECT private-journal-text',
      }),
    );

    const database = await db();
    const error = await database
      .query('SELECT $1::text', ['synthetic-journal'])
      .catch((failure: unknown) => failure);
    assert(error instanceof AppError);
    expect(error.status).toBe(503);
    expect(error.message).toContain('[DB_TLS]');
    expect(error.message).not.toContain(privateText);
    expect(error).not.toHaveProperty('detail');
    expect(error).not.toHaveProperty('query');
    expect(error.stack).not.toContain(privateText);
    expect(remoteUnsafe).toHaveBeenCalledWith('SELECT $1::text', ['synthetic-journal']);
  });

  it('maps connection failures that occur before a transaction callback begins', async () => {
    begin.mockRejectedValue(
      Object.assign(new Error('private-host and private-password'), {
        code: 'CONNECT_TIMEOUT',
      }),
    );
    const callback = vi.fn();
    const database = await db();
    const error = await database.transaction(callback).catch((failure: unknown) => failure);

    assert(error instanceof AppError);
    expect(error.status).toBe(503);
    expect(error.message).toContain('[DB_CONNECT]');
    expect(error.message).not.toContain('private-host');
    expect(error.message).not.toContain('private-password');
    expect(callback).not.toHaveBeenCalled();
  });

  it('maps SET LOCAL ROLE permission failures and does not execute user work', async () => {
    const syntheticUser = '00000000-0000-4000-8000-000000000001';
    transactionUnsafe.mockImplementation(async (query) => {
      if (query === 'SET LOCAL ROLE authenticated') {
        throw Object.assign(new Error(`private-role-details ${syntheticUser}`), {
          code: '42501',
          query,
          parameters: [syntheticUser, 'private-journal-text'],
        });
      }
      return [];
    });
    const userWork = vi.fn();
    const error = await asUser(syntheticUser, userWork).catch((failure: unknown) => failure);

    expect(transactionUnsafe.mock.calls).toEqual([
      ["SELECT set_config('request.jwt.claim.sub',$1,true)", [syntheticUser]],
      ['SET LOCAL ROLE authenticated', []],
    ]);
    assert(error instanceof AppError);
    expect(error.status).toBe(503);
    expect(error.message).toContain('[DB_PERMISSION]');
    const returned = JSON.stringify({ ...error, message: error.message, stack: error.stack });
    for (const privateText of [
      syntheticUser,
      'private-role-details',
      'SET LOCAL ROLE',
      'private-journal-text',
    ]) {
      expect(returned).not.toContain(privateText);
    }
    expect(userWork).not.toHaveBeenCalled();
  });

  it('preserves a unique constraint error for registration conflict handling', async () => {
    const original = Object.assign(new Error('synthetic duplicate account'), { code: '23505' });
    remoteUnsafe.mockRejectedValue(original);
    const database = await db();
    await expect(
      database.query('INSERT INTO users (id) VALUES ($1)', ['synthetic-user']),
    ).rejects.toBe(original);
  });

  it('keeps TLS verification enabled even when the URL contains sslmode=require', async () => {
    await db();
    expect(postgresMock).toHaveBeenCalledOnce();
    expect(postgresMock).toHaveBeenCalledWith(
      syntheticUrl,
      expect.objectContaining({
        ssl: expect.objectContaining({ rejectUnauthorized: true }),
      }),
    );
  });

  it('replaces constructor URI errors with safe configuration advice', async () => {
    postgresMock.mockImplementation(() => {
      throw new URIError(`Unable to parse ${syntheticUrl}`);
    });
    const error = await db().catch((failure: unknown) => failure);

    assert(error instanceof AppError);
    expect(error.status).toBe(503);
    expect(error.message).toContain('[DB_CONFIG]');
    const returned = JSON.stringify({ ...error, message: error.message, stack: error.stack });
    for (const privateText of [
      syntheticUrl,
      'synthetic-password',
      'synthetic-user',
      'database.example.test',
    ]) {
      expect(returned).not.toContain(privateText);
    }
    expect(error).not.toHaveProperty('cause');
    expect(remoteUnsafe).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });

  it('preserves an existing safe constructor AppError', async () => {
    const original = new AppError(503, '[DB_TLS] 安全な証明書設定エラー');
    postgresMock.mockImplementation(() => {
      throw original;
    });
    await expect(db()).rejects.toBe(original);
  });
});
