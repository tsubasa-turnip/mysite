import { describe, expect, it, vi } from 'vitest';
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
      'CONNECTION_TIMEOUT',
      'CONNECT_TIMEOUT',
    ],
    category: 'DB_CONNECT',
    advice: '接続先とネットワーク設定',
  },
];

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
