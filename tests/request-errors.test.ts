import { describe, expect, it, vi } from 'vitest';
import { unexpectedRequestError } from '../src/lib/request-errors';

describe('safe unexpected request diagnostics', () => {
  it.each([
    ['auth/login', 'IW_AUTH_LOGIN'],
    ['auth/register', 'IW_AUTH_REGISTER'],
    ['auth/resend-confirmation', 'IW_AUTH_EMAIL'],
    ['me', 'IW_PROFILE'],
    ['profile', 'IW_PROFILE'],
    ['journals', 'IW_JOURNALS'],
    ['candidates', 'IW_CANDIDATES'],
    ['imports', 'IW_IMPORTS'],
    ['conversations', 'IW_CONVERSATIONS'],
    ['messages', 'IW_MESSAGES'],
    ['insights', 'IW_INSIGHTS'],
    ['reflect', 'IW_REFLECT'],
    ['imports/preview', 'IW_IMPORTS'],
    ['imports/95d6ca20-a1bd-4f33-8c82-e2cfe56ba7c3/step', 'IW_IMPORTS'],
    ['journals/95d6ca20-a1bd-4f33-8c82-e2cfe56ba7c3', 'IW_JOURNALS'],
  ])('returns a static diagnostic for %s', (route, diagnostic) => {
    expect(unexpectedRequestError(route)).toEqual({
      error: `[${diagnostic}] 処理を完了できませんでした。設定と接続を確認してください`,
      diagnostic,
    });
  });

  it.each([
    '',
    'unknown',
    '__proto__',
    'constructor',
    'auth/logout',
    'auth/login/extra',
    'profile/private-user',
    'auth/login?token=private-token',
    'imports/private-user@example.test',
    'journals/../../auth/login',
    'journals/%2e%2e/private-password',
    'journals//private-password',
    'journals\\private-password',
    'reflect/<script>private-script</script>',
    'messages/https://private-user:private-password@example.test',
    'insights/private\njournal-text',
    'conversations/private\u0000journal-text',
    'PRIVATE_EMAIL@example.test',
    '個人の記録',
  ])('uses the generic code for unknown or malformed route %s', (route) => {
    const response = unexpectedRequestError(route);
    expect(response).toEqual({
      error: '[IW_SERVER] 処理を完了できませんでした。設定と接続を確認してください',
      diagnostic: 'IW_SERVER',
    });
    if (route) expect(JSON.stringify(response)).not.toContain(route);
  });

  it('does not expose identifiers or log input', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const identifier = '95d6ca20-a1bd-4f33-8c82-e2cfe56ba7c3';
      const response = unexpectedRequestError(`messages/${identifier}`);
      expect(response.diagnostic).toBe('IW_MESSAGES');
      expect(JSON.stringify(response)).not.toContain(identifier);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
