import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { authenticate, resendConfirmation } from '../src/lib/auth';
import { AppError } from '../src/lib/validation';

const { createClient, signUp, signIn, resend, query, database, asUser, cookieSet, cookies } =
  vi.hoisted(() => ({
    createClient: vi.fn(),
    signUp: vi.fn(),
    signIn: vi.fn(),
    resend: vi.fn(),
    query: vi.fn(),
    database: vi.fn(),
    asUser: vi.fn(),
    cookieSet: vi.fn(),
    cookies: vi.fn(),
  }));

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('../src/lib/db', () => ({ db: database, asUser }));
vi.mock('next/headers', () => ({ cookies }));

const email = 'recovery@example.test';
const credentials = { email, password: 'synthetic-test-password' };
const privateValues = [email, credentials.password, 'synthetic-access-token'];
const privateMessage = `Provider private details: ${privateValues.join(' ')}`;

function safeError(error: unknown) {
  assert(error instanceof AppError);
  const output = JSON.stringify({ ...error, message: error.message, stack: error.stack });
  for (const value of privateValues) expect(output).not.toContain(value);
  expect(output).not.toContain(privateMessage);
  expect(error).not.toHaveProperty('cause');
  return error;
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('INNER_WEATHER_LOCAL', undefined);
  vi.stubEnv('DATABASE_URL', 'postgres://synthetic@database.example.test/app');
  vi.stubEnv('SUPABASE_URL', 'https://synthetic.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'synthetic-publishable-key');
  vi.stubEnv('APP_ORIGIN', 'https://journal.example.test');
  query.mockReset().mockResolvedValue([]);
  database.mockReset().mockResolvedValue({ query });
  asUser.mockReset().mockImplementation(async (_id, callback) => callback({ query }));
  cookieSet.mockReset();
  cookies.mockReset().mockResolvedValue({ set: cookieSet });
  signUp.mockReset();
  signIn.mockReset();
  resend.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null });
  createClient.mockReset().mockReturnValue({
    auth: { signUp, signInWithPassword: signIn, resend },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('confirmation email requests', () => {
  it('normalizes the email and ignores client redirect input in favor of the configured origin', async () => {
    const result = await resendConfirmation({
      email: 'RECOVERY@EXAMPLE.TEST',
      redirectTo: 'https://attacker.example.test',
      options: { emailRedirectTo: 'https://attacker.example.test' },
    });
    expect(resend).toHaveBeenCalledExactlyOnceWith({
      type: 'signup',
      email,
      options: { emailRedirectTo: 'https://journal.example.test' },
    });
    expect(result).toEqual({ accepted: true });
    expect(database).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'an unknown address', data: { user: null, session: null } },
    {
      label: 'an already confirmed account',
      data: {
        user: { id: 'synthetic-confirmed-user', email, email_confirmed_at: '2026-10-01T00:00:00Z' },
        session: { access_token: privateValues[2] },
      },
    },
  ])('returns the same acknowledgment for $label without provider data', async ({ data }) => {
    resend.mockResolvedValue({ data, error: null });
    const result = await resendConfirmation({ email });
    expect(result).toEqual({ accepted: true });
    expect(Object.keys(result)).toEqual(['accepted']);
    for (const value of privateValues) expect(JSON.stringify(result)).not.toContain(value);
    expect(query).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('rejects malformed input before requesting any email', async () => {
    await expect(resendConfirmation({ email: 'not-an-email' })).rejects.toBeInstanceOf(ZodError);
    expect(resend).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'email_address_not_authorized', status: 503, text: '[AUTH_EMAIL]' },
    { code: 'over_email_send_rate_limit', status: 429, text: '少し時間をおいて' },
  ])(
    'classifies $code without surfacing private provider information',
    async ({ code, status, text }) => {
      resend.mockResolvedValue({ error: { code, message: privateMessage } });
      const error = safeError(
        await resendConfirmation({ email }).catch((failure: unknown) => failure),
      );
      expect(error.status).toBe(status);
      expect(error.message).toContain(text);
      expect(cookieSet).not.toHaveBeenCalled();
    },
  );

  it('uses a fixed 502 for an unknown provider failure and never logs its contents', async () => {
    resend.mockResolvedValue({
      error: { code: 'future_provider_failure', message: privateMessage },
    });
    const logs = ['log', 'warn', 'error'].map((name) =>
      vi.spyOn(console, name as 'log' | 'warn' | 'error').mockImplementation(() => {}),
    );
    try {
      const error = safeError(
        await resendConfirmation({ email }).catch((failure: unknown) => failure),
      );
      expect(error.status).toBe(502);
      expect(error.message).toBe('[AUTH_EMAIL] 確認メールの再送要求を完了できませんでした');
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });

  it('fails safely when the Supabase client is unavailable', async () => {
    vi.stubEnv('SUPABASE_URL', undefined);
    vi.stubEnv('SUPABASE_ANON_KEY', undefined);
    const error = safeError(
      await resendConfirmation({ email }).catch((failure: unknown) => failure),
    );
    expect(error.status).toBe(503);
    expect(resend).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('Supabase login account synchronization', () => {
  it('preserves existing records and refuses a session when another account owns the email', async () => {
    signIn.mockResolvedValue({
      data: {
        user: { id: 'synthetic-new-user', email },
        session: { access_token: privateValues[2] },
      },
      error: null,
    });
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      expect(sql).toContain('INSERT INTO users');
      expect(sql).toContain('ON CONFLICT(id)');
      expect(params).toEqual(['synthetic-new-user', email]);
      throw Object.assign(new Error(privateMessage), { code: '23505', detail: privateMessage });
    });
    const error = safeError(
      await authenticate(credentials, false).catch((failure: unknown) => failure),
    );
    expect(error.status).toBe(409);
    expect(error.message).toContain('[AUTH_ACCOUNT]');
    expect(query).toHaveBeenCalledOnce();
    expect(asUser).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it.each([
    { user: { id: 'synthetic-user', email }, session: null },
    { user: null, session: { access_token: privateValues[2] } },
  ])(
    'rejects an incomplete login response without asking the user to verify email',
    async (data) => {
      signIn.mockResolvedValue({ data, error: null });
      const error = safeError(
        await authenticate(credentials, false).catch((failure: unknown) => failure),
      );
      expect(error.status).toBe(502);
      expect(error.message).toContain('[AUTH_SESSION]');
      expect(error.message).not.toContain('確認メール');
      expect(query).not.toHaveBeenCalled();
      expect(asUser).not.toHaveBeenCalled();
      expect(cookieSet).not.toHaveBeenCalled();
    },
  );
});
