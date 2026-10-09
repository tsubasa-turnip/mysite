import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

const names = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'DATA_ENCRYPTION_KEY',
  'APP_ORIGIN',
];
function preflight(overrides: Record<string, string> = {}) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/check-deploy.ts'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...Object.fromEntries(names.map((name) => [name, ''])),
        OPENAI_API_KEY: '',
        IW_OPENAI_API_KEY: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        INNER_WEATHER_LOCAL: '',
        VERCEL: '',
        MAX_UPLOAD_MB: '4',
        ...overrides,
      },
    },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}
const valid = {
  DATABASE_URL: 'postgresql://postgres:synthetic-password@db.example.test:5432/postgres',
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_ANON_KEY: 'synthetic-anon-key',
  DATA_ENCRYPTION_KEY: 'ab'.repeat(32),
  APP_ORIGIN: 'https://inner-weather.example.test',
};
describe('production deployment preflight', () => {
  it('blocks publication with missing service configuration', () => {
    const result = preflight();
    expect(result.status).toBe(2);
    for (const name of names) expect(result.output).toContain(`${name}: 未設定`);
  });
  it('validates offline and never prints credential values', () => {
    const result = preflight(valid);
    expect(result.status).toBe(0);
    expect(result.output).toContain('実接続・マイグレーションは別途検証');
    expect(result.output).toContain('OpenAI未設定');
    for (const value of Object.values(valid)) expect(result.output).not.toContain(value);
  });
  it('blocks insecure origins, local database mode, weak encryption, and excessive Vercel uploads', () => {
    const result = preflight({
      ...valid,
      APP_ORIGIN: 'http://localhost:3000',
      DATA_ENCRYPTION_KEY: 'synthetic-invalid-secret',
      INNER_WEATHER_LOCAL: '1',
      VERCEL: '1',
      MAX_UPLOAD_MB: '25',
    });
    expect(result.status).toBe(2);
    for (const name of [
      'APP_ORIGIN',
      'DATA_ENCRYPTION_KEY',
      'INNER_WEATHER_LOCAL',
      'MAX_UPLOAD_MB',
    ])
      expect(result.output).toContain(name);
    expect(result.output).not.toContain('synthetic-invalid-secret');
    expect(result.output).not.toContain('synthetic-password');
  });
});
