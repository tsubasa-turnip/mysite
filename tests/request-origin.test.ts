import { describe, expect, it } from 'vitest';
import { assertRequestOrigin } from '../src/lib/request-origin';

const env = {
  NODE_ENV: 'production',
  VERCEL: '1',
  APP_ORIGIN: 'https://inner-weather.example.test',
  VERCEL_URL: 'mysite-c39c869up-inner-weather.vercel.app',
  VERCEL_BRANCH_URL: 'mysite-git-codex-inner-weather-iphone-inner-weather.vercel.app',
  VERCEL_PROJECT_PRODUCTION_URL: 'mysite-inner-weather.vercel.app',
};
function mutation(origin?: string, url = `https://${env.VERCEL_URL}/api/auth/login`) {
  return new Request(url, { method: 'POST', headers: origin ? { origin } : {} });
}

describe('request origin authorization', () => {
  it('allows login/register mutations from the configured and Vercel-issued project URLs', () => {
    for (const origin of [
      env.APP_ORIGIN,
      ...[env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].map(
        (v) => `https://${v}`,
      ),
    ]) {
      for (const path of ['login', 'register'])
        expect(() =>
          assertRequestOrigin(mutation(origin, `https://${env.VERCEL_URL}/api/auth/${path}`), env),
        ).not.toThrow();
    }
  });
  it('accepts an exact custom production domain supplied by Vercel', () => {
    expect(() =>
      assertRequestOrigin(mutation('https://journal.example.test'), {
        ...env,
        VERCEL_PROJECT_PRODUCTION_URL: 'journal.example.test',
      }),
    ).not.toThrow();
  });
  it('rejects missing, opaque, unrelated, suffix-spoofed and downgraded origins', () => {
    for (const origin of [
      undefined,
      'null',
      'https://attacker.vercel.app',
      `https://${env.VERCEL_URL}.evil.example.test`,
      `http://${env.VERCEL_URL}`,
      'https://inner-weather.example.test.evil.example.test',
    ])
      expect(() => assertRequestOrigin(mutation(origin), env)).toThrow(
        expect.objectContaining({ status: 403 }),
      );
  });
  it('does not trust forged request or forwarding headers', () => {
    const request = mutation(
      'https://attacker.example.test',
      'https://attacker.example.test/api/auth/login',
    );
    request.headers.set('host', env.VERCEL_URL);
    request.headers.set('x-forwarded-host', 'attacker.example.test');
    request.headers.set('x-forwarded-proto', 'https');
    expect(() => assertRequestOrigin(request, env)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
  it('ignores platform-shaped variables outside Vercel and rejects malformed platform hosts', () => {
    expect(() =>
      assertRequestOrigin(mutation(`https://${env.VERCEL_URL}`), { ...env, VERCEL: '' }),
    ).toThrow(expect.objectContaining({ status: 403 }));
    for (const value of [
      'user@attacker.example.test',
      'attacker.example.test/path',
      'attacker.example.test?x=1',
      'https://attacker.example.test',
      'attacker.example.test#fragment',
    ]) {
      expect(() =>
        assertRequestOrigin(mutation('https://attacker.example.test'), {
          ...env,
          VERCEL_URL: value,
        }),
      ).toThrow(expect.objectContaining({ status: 403 }));
    }
  });
  it('preserves local development but fails closed when production origin settings are absent', () => {
    const request = mutation('http://127.0.0.1:3000', 'http://127.0.0.1:3000/api/auth/login');
    expect(() => assertRequestOrigin(request, { NODE_ENV: 'development' })).not.toThrow();
    expect(() =>
      assertRequestOrigin(request, { NODE_ENV: 'production', INNER_WEATHER_LOCAL: '1' }),
    ).not.toThrow();
    expect(() => assertRequestOrigin(request, { NODE_ENV: 'production' })).toThrow(
      expect.objectContaining({ status: 503 }),
    );
    expect(() =>
      assertRequestOrigin(request, { ...env, APP_ORIGIN: `${env.APP_ORIGIN}/` }),
    ).toThrow(expect.objectContaining({ status: 503 }));
  });
});
