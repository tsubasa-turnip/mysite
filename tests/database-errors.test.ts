import { describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { databaseError } from '../src/lib/database-errors';
import { AppError } from '../src/lib/validation';

const knownFailures = [
  { codes: ['28P01', '28000'], category: 'DB_AUTH', advice: 'DBユーザー名とパスワード' },
  { codes: ['3D000'], category: 'DB_DATABASE', advice: 'データベース名' },
  { codes: ['42P01', '42703'], category: 'DB_SCHEMA', advice: 'マイグレーションSQL' },
  { codes: ['42501'], category: 'DB_PERMISSION', advice: 'DBユーザーと権限' },
  {
    codes: [
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ],
    category: 'DB_TLS',
    advice: '信頼できるCA証明書',
  },
  {
    codes: [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ECONNRESET',
      'EPIPE',
      'ERR_SOCKET_CONNECTION_TIMEOUT',
      'CONNECTION_TIMEOUT',
      'CONNECT_TIMEOUT',
      'CONNECTION_CLOSED',
      'CONNECTION_ENDED',
      'CONNECTION_DESTROYED',
      '08000',
      '08003',
      '08006',
      '08001',
      '08004',
      '57P03',
    ],
    category: 'DB_CONNECT',
    advice: '接続先とネットワーク設定',
  },
  { codes: ['53300'], category: 'DB_CONNECT', advice: '時間をおいて' },
  { codes: ['XX000'], category: 'DB_SERVER', advice: '内部エラー' },
];

// The driver's runtime constructor accepts parsed wire fields; its declarations inherit
// Error's string-only constructor, so Reflect supplies the real protocol object.
function providerFailure(message: string): postgres.PostgresError {
  return Reflect.construct(postgres.PostgresError, [
    { severity_local: 'FATAL', code: 'XX000', message },
  ]) as postgres.PostgresError;
}

describe('safe database infrastructure errors', () => {
  for (const { codes, category, advice } of knownFailures) {
    it.each(codes)('classifies %s with actionable configuration advice', (code) => {
      const error = databaseError({ code });
      expect(error).toBeInstanceOf(AppError);
      expect(error?.status).toBe(503);
      expect(error?.message).toContain(`[${category}]`);
      expect(error?.message).toContain(advice);
    });
  }

  it('leaves business validation, constraints, and unknown codes to the caller', () => {
    for (const code of [
      '23505',
      '23503',
      '23514',
      'future_error',
      '__proto__',
      'constructor',
      '',
      28000,
    ]) {
      expect(databaseError({ code })).toBeNull();
    }
    for (const input of [undefined, null, '28P01', 28000, {}, new Error('28P01')]) {
      expect(databaseError(input)).toBeNull();
    }
  });

  it('preserves an existing AppError even when it has a recognized provider code', () => {
    const original = Object.assign(new AppError(409, 'ユーザーが修正できるエラー'), {
      code: '28P01',
    });
    expect(databaseError(original)).toBeNull();
  });

  it('does not infer classifications from provider messages or nested causes', () => {
    expect(databaseError({ message: '28P01', cause: { code: '28P01' } })).toBeNull();
    expect(databaseError({ code: 'unknown', message: 'ECONNREFUSED' })).toBeNull();
    expect(
      databaseError({
        get code() {
          throw new Error('private provider failure');
        },
      }),
    ).toBeNull();
    expect(databaseError({ code: 'unknown', message: 'Tenant or user not found' })).toBeNull();
    expect(databaseError({ cause: providerFailure('Tenant or user not found') })).toBeNull();
  });

  it.each([
    'Tenant or user not found',
    '(ENOTFOUND) tenant/user private-db-user.private-project-ref not found',
  ])('recognizes the provider tenant lookup failure without returning its input', (message) => {
    const original = providerFailure(message);
    expect(original).toBeInstanceOf(postgres.PostgresError);
    expect(original.code).toBe('XX000');
    expect(typeof original.code).toBe('string');
    const error = databaseError(original);

    expect(error).toBeInstanceOf(AppError);
    expect(error?.status).toBe(503);
    expect(error?.message).toContain('[DB_POOLER]');
    expect(error?.message).toContain('postgres.<project-ref>');
    for (const privateText of ['private-db-user', 'private-project-ref', message]) {
      expect(error?.message).not.toContain(privateText);
    }
  });

  it.each([
    'Internal database failure private-journal-text',
    'Tenant or user not found: unrelated extension failure',
    'prefix (ENOTFOUND) tenant/user private.user not found',
    '(ENOTFOUND) tenant/user private.user not found suffix',
    '(ENOTFOUND) tenant/user private\nuser not found',
    '(ENOTFOUND) tenant/user private user not found',
    '(ENOTFOUND) tenant/user private.user not found\n',
    '(ENOTFOUND) tenant/user private.user not found\r\n',
  ])(
    'keeps unrelated XX000 failures generic without claiming an authentication cause',
    (message) => {
      const error = databaseError(providerFailure(message));
      expect(error?.status).toBe(503);
      expect(error?.message).toContain('[DB_SERVER]');
      expect(error?.message).not.toContain('[DB_POOLER]');
      expect(error?.message).not.toContain('パスワード');
      expect(error?.message).not.toContain(message);
    },
  );

  it('handles unreadable XX000 provider text using the generic server classification', () => {
    const error = databaseError({
      code: 'XX000',
      get message() {
        throw new Error('private provider details');
      },
    });
    expect(error?.status).toBe(503);
    expect(error?.message).toContain('[DB_SERVER]');
  });

  it('returns and logs no credentials, query contents, provider details, or nested error data', () => {
    const privateText = 'postgres://private-user:private-password@private-host/private-db';
    const privateQuery = "insert into journal_entries values ('private-journal-text')";
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const { codes } of knownFailures) {
        for (const code of codes) {
          const input = {
            code,
            message: privateText,
            detail: privateText,
            query: privateQuery,
            parameters: ['private-user-email@example.test'],
            stack: privateText,
            cause: { message: privateText },
          };
          const error = databaseError(input);
          expect(error).not.toBeNull();
          expect(error).not.toHaveProperty('cause');
          expect(error).not.toHaveProperty('detail');
          expect(error).not.toHaveProperty('query');
          expect(error).not.toHaveProperty('parameters');
          const serialized = JSON.stringify({
            ...error,
            message: error?.message,
            stack: error?.stack,
          });
          for (const secret of [privateText, privateQuery, 'private-user-email@example.test']) {
            expect(serialized).not.toContain(secret);
          }
        }
      }
      for (const message of [
        'Tenant or user not found',
        '(ENOTFOUND) tenant/user private-user.private-project-ref not found',
      ]) {
        const original = Object.assign(providerFailure(message), {
          detail: privateText,
          query: privateQuery,
          parameters: ['private-user-email@example.test'],
          cause: { message: privateText },
          stack: privateText,
        });
        const error = databaseError(original);
        expect(error?.message).toContain('[DB_POOLER]');
        expect(error).not.toHaveProperty('cause');
        const serialized = JSON.stringify({
          ...error,
          message: error?.message,
          stack: error?.stack,
        });
        for (const secret of [
          privateText,
          privateQuery,
          message,
          'private-user',
          'private-project-ref',
          'private-user-email@example.test',
        ]) {
          expect(serialized).not.toContain(secret);
        }
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
