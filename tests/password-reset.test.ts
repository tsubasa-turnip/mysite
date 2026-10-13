import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { requestPasswordReset, resetPassword } from '../src/lib/password-recovery';
import { AppError } from '../src/lib/validation';

const { createClient, sendReset, getUser, fetchMock, cookies, cookieDelete, database, asUser } =
  vi.hoisted(() => ({
    createClient: vi.fn(),
    sendReset: vi.fn(),
    getUser: vi.fn(),
    fetchMock: vi.fn(),
    cookies: vi.fn(),
    cookieDelete: vi.fn(),
    database: vi.fn(),
    asUser: vi.fn(),
  }));

vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('next/headers', () => ({ cookies }));
vi.mock('../src/lib/db', () => ({ db: database, asUser }));

const email = 'recovery@example.test';
const token = 'synthetic-recovery-access-token';
const password = 'new-synthetic-test-password';
const trustedOrigin = 'https://journal.example.test';
const userId = '95d6ca20-a1bd-4f33-8c82-e2cfe56ba7c3';
const serviceKey = 'synthetic-admin-key-never-use';
const privateMessage = `Private provider details: ${email} ${token} ${password} ${serviceKey}`;

function safeError(error: unknown) {
  assert(error instanceof AppError);
  const serialized = JSON.stringify({ ...error, message: error.message, stack: error.stack });
  for (const privateValue of [email, token, password, serviceKey, privateMessage])
    expect(serialized).not.toContain(privateValue);
  expect(error).not.toHaveProperty('cause');
  return error;
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://synthetic.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'synthetic-publishable-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey);
  vi.stubEnv('DATA_ENCRYPTION_KEY', 'a'.repeat(64));
  sendReset.mockReset().mockResolvedValue({ data: {}, error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: userId, email } }, error: null });
  createClient.mockReset().mockReturnValue({ auth: { resetPasswordForEmail: sendReset, getUser } });
  fetchMock.mockReset().mockResolvedValue(Response.json({ id: userId, email }));
  vi.stubGlobal('fetch', fetchMock);
  cookieDelete.mockReset();
  cookies.mockReset().mockResolvedValue({ delete: cookieDelete });
  database.mockReset();
  asUser.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('password reset email requests', () => {
  it('normalizes the email and uses only the trusted return origin, ignoring client redirects', async () => {
    const result = await requestPasswordReset(
      {
        email: 'RECOVERY@EXAMPLE.TEST',
        redirectTo: 'https://attacker.example.test',
        options: { redirectTo: 'https://attacker.example.test' },
      },
      trustedOrigin,
    );
    expect(sendReset).toHaveBeenCalledExactlyOnceWith(email, {
      redirectTo: `${trustedOrigin}/?password-reset=1`,
    });
    expect(result).toEqual({ accepted: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
    expect(asUser).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'an unknown account', data: { user: null, session: null } },
    {
      label: 'an existing account',
      data: { user: { id: userId, email }, session: { access_token: token } },
    },
  ])('returns the same acknowledgment for $label without provider data', async ({ data }) => {
    sendReset.mockResolvedValue({ data, error: null });
    const result = await requestPasswordReset({ email }, trustedOrigin);
    expect(result).toEqual({ accepted: true });
    for (const privateValue of [email, userId, token])
      expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(cookieDelete).not.toHaveBeenCalled();
  });

  it('does not request email for malformed input', async () => {
    await expect(
      requestPasswordReset({ email: 'not-an-email' }, trustedOrigin),
    ).rejects.toBeInstanceOf(ZodError);
    expect(sendReset).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not reveal an unknown account reported as a provider error', async () => {
    sendReset.mockResolvedValue({
      error: { code: 'user_not_found', message: privateMessage },
    });
    await expect(requestPasswordReset({ email }, trustedOrigin)).resolves.toEqual({
      accepted: true,
    });
  });

  it.each([
    'https://journal.example.test/path',
    'https://journal.example.test/',
    'https://journal.example.test?token=private-token',
    'https://journal.example.test#fragment',
    'https://private-user:private-password@journal.example.test',
    'http://journal.example.test',
    'javascript:private-token',
  ])('rejects an invalid return origin before any email request', async (returnOrigin) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INNER_WEATHER_LOCAL', undefined);
    const error = safeError(
      await requestPasswordReset({ email }, returnOrigin).catch((failure: unknown) => failure),
    );
    expect(error.status).toBe(503);
    expect(error.message).toContain('[AUTH_RECOVERY]');
    expect(sendReset).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'email_address_not_authorized', status: 503 },
    { code: 'over_email_send_rate_limit', status: 429 },
    { code: 'future_provider_failure', status: 502 },
  ])('handles $code without exposing provider information', async ({ code, status }) => {
    sendReset.mockResolvedValue({ error: { code, message: privateMessage } });
    const error = safeError(
      await requestPasswordReset({ email }, trustedOrigin).catch((failure: unknown) => failure),
    );
    expect(error.status).toBe(status);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('verified password reset', () => {
  it('verifies the access token before updating only its own account with the publishable key', async () => {
    const order: string[] = [];
    getUser.mockImplementation(async (accessToken) => {
      order.push('verify');
      expect(accessToken).toBe(token);
      return { data: { user: { id: userId, email } }, error: null };
    });
    fetchMock.mockImplementation(async () => {
      order.push('update');
      return Response.json({ id: userId, email, private_provider_data: privateMessage });
    });

    const result = await resetPassword({
      access_token: token,
      password,
      user_id: 'attacker-user-id',
      email: 'attacker@example.test',
      role: 'admin',
      app_metadata: { role: 'admin' },
    });

    expect(order).toEqual(['verify', 'update']);
    expect(getUser).toHaveBeenCalledExactlyOnceWith(token);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://synthetic.supabase.co/auth/v1/user');
    expect(options.method).toBe('PUT');
    const headers = new Headers(options.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(headers.get('apikey')).toBe('synthetic-publishable-key');
    expect(headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(String(options.body))).toEqual({ password });
    expect(JSON.stringify(options)).not.toContain(serviceKey);
    expect(result).toEqual({ updated: true });
    expect(createClient).toHaveBeenCalledWith(
      'https://synthetic.supabase.co',
      'synthetic-publishable-key',
      expect.any(Object),
    );
    expect(database).not.toHaveBeenCalled();
    expect(asUser).not.toHaveBeenCalled();
    expect(process.env.DATA_ENCRYPTION_KEY).toBe('a'.repeat(64));
    expect(cookieDelete).toHaveBeenCalledExactlyOnceWith('iw_session');
  });

  it.each([
    {
      label: 'an expired token',
      response: { data: { user: null }, error: { code: 'bad_jwt', message: privateMessage } },
    },
    { label: 'a response without a user', response: { data: { user: null }, error: null } },
    {
      label: 'a user without an identity',
      response: { data: { user: { email } }, error: null },
    },
    {
      label: 'a user with an empty identity',
      response: { data: { user: { id: '', email } }, error: null },
    },
    {
      label: 'an error even when a user is returned',
      response: {
        data: { user: { id: userId, email } },
        error: { code: 'bad_jwt', message: privateMessage },
      },
    },
  ])('rejects $label before any password mutation', async ({ response }) => {
    getUser.mockResolvedValue(response);
    const error = safeError(
      await resetPassword({ access_token: token, password }).catch((failure: unknown) => failure),
    );
    expect(error.status).toBe(401);
    expect(error.message).toContain('[AUTH_RECOVERY]');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookieDelete).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
  });

  it.each([
    { password },
    { access_token: '', password },
    { access_token: 'x'.repeat(8193), password },
    { access_token: token },
    { access_token: token, password: 'short' },
    { access_token: token, password: 'x'.repeat(129) },
  ])('rejects invalid input before contacting auth APIs', async (input) => {
    await expect(resetPassword(input)).rejects.toBeInstanceOf(ZodError);
    expect(getUser).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookieDelete).not.toHaveBeenCalled();
  });

  it.each([
    { providerField: 'error_code', code: 'over_request_rate_limit', status: 429 },
    { providerField: 'code', code: 'over_request_rate_limit', status: 429 },
    { providerField: 'error_code', code: 'future_provider_failure', status: 502 },
    { providerField: 'code', code: 'future_provider_failure', status: 502 },
    { providerField: 'error_code', code: 'weak_password', status: 400 },
    { providerField: 'code', code: 'same_password', status: 400 },
  ])(
    'classifies only known provider $providerField values',
    async ({ providerField, code, status }) => {
      fetchMock.mockResolvedValue(
        Response.json(
          { [providerField]: code, message: privateMessage, error_description: privateMessage },
          { status: 400 },
        ),
      );
      const error = safeError(
        await resetPassword({ access_token: token, password }).catch((failure: unknown) => failure),
      );
      expect(error.status).toBe(status);
      if (status === 502) expect(error.message).toContain('[AUTH_RECOVERY]');
      expect(cookieDelete).not.toHaveBeenCalled();
      expect(database).not.toHaveBeenCalled();
    },
  );

  it('does not infer provider codes from raw text and never logs secrets', async () => {
    fetchMock.mockResolvedValue(
      new Response(`over_request_rate_limit ${privateMessage}`, { status: 500 }),
    );
    const logs = ['log', 'warn', 'error'].map((name) =>
      vi.spyOn(console, name as 'log' | 'warn' | 'error').mockImplementation(() => {}),
    );
    try {
      const error = safeError(
        await resetPassword({ access_token: token, password }).catch((failure: unknown) => failure),
      );
      expect(error.status).toBe(502);
      expect(error.message).toContain('[AUTH_RECOVERY]');
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
});

describe('password reset configuration', () => {
  it.each(['SUPABASE_URL', 'SUPABASE_ANON_KEY'])(
    'requires %s for either operation',
    async (name) => {
      vi.stubEnv(name, undefined);
      for (const operation of [
        () => requestPasswordReset({ email }, trustedOrigin),
        () => resetPassword({ access_token: token, password }),
      ]) {
        const error = safeError(await operation().catch((failure: unknown) => failure));
        expect(error.status).toBe(503);
      }
      expect(sendReset).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
