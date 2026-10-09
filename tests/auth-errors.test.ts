import { describe, expect, it, vi } from 'vitest';
import { authProviderError } from '../src/lib/auth-errors';
import { AppError } from '../src/lib/validation';

describe('safe authentication provider errors', () => {
  it('explains that an unconfirmed email must be verified before login', () => {
    const error = authProviderError({ code: 'email_not_confirmed', status: 400 });
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(401);
    expect(error.message).toContain('確認メールのリンク');
  });

  it.each(['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit'])(
    'asks the user to wait when the provider reports %s',
    (code) => {
      const error = authProviderError({ code, status: 429 });
      expect(error.status).toBe(429);
      expect(error.message).toContain('少し時間をおいて');
    },
  );

  it.each(['signup_disabled', 'email_provider_disabled'])(
    'identifies unavailable authentication for %s',
    (code) => {
      const error = authProviderError({ code, status: 400 });
      expect(error.status).toBe(503);
      expect(error.message).toContain('認証設定を確認');
    },
  );

  it('keeps invalid credentials generic without identifying an existing account', () => {
    const error = authProviderError({ code: 'invalid_credentials', status: 400 });
    expect(error.status).toBe(401);
    expect(error.message).toBe('メールアドレスまたはパスワードを確認してください');
  });

  it('uses a generic 400 for absent or unknown codes regardless of provider status', () => {
    for (const input of [{}, { code: 'future_provider_error', status: 500 }, { status: 401 }]) {
      const error = authProviderError(input);
      expect(error.status).toBe(400);
      expect(error.message).toBe('認証できませんでした。メールアドレスとパスワードを確認してください');
    }
  });

  it('never returns or logs provider text, email, password, or token', () => {
    const secrets = ['synthetic@example.test', 'synthetic-password', 'synthetic-access-token'];
    const providerMessage = `Provider internal failure: ${secrets.join(' ')}`;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const code of [
        'email_not_confirmed',
        'over_email_send_rate_limit',
        'email_provider_disabled',
        'invalid_credentials',
        'unknown_provider_error',
      ]) {
        const providerError = { code, status: 400, message: providerMessage };
        const error = authProviderError(providerError);
        const serialized = JSON.stringify({ ...error, message: error.message, stack: error.stack });
        for (const secret of [...secrets, providerMessage]) expect(serialized).not.toContain(secret);
        expect(error).not.toHaveProperty('cause');
      }
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      errorLog.mockRestore();
    }
  });
});
