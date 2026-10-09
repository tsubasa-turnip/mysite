import { AppError } from './validation';

/** Converts only known infrastructure codes; provider text never leaves the server. */
export function databaseError(error: unknown): AppError | null {
  if (error instanceof AppError || typeof error !== 'object' || error === null) return null;

  let code: unknown;
  try {
    code = (error as { code?: unknown }).code;
  } catch {
    return null;
  }

  switch (code) {
    case '28P01':
    case '28000':
      return new AppError(
        503,
        '[DB_AUTH] データベースの認証に失敗しました。DATABASE_URLのDBユーザー名とパスワードを確認してください',
      );
    case '3D000':
      return new AppError(
        503,
        '[DB_DATABASE] データベースが見つかりません。DATABASE_URLのデータベース名を確認してください',
      );
    case '42P01':
    case '42703':
      return new AppError(
        503,
        '[DB_SCHEMA] アプリに必要なテーブルまたは列が見つかりません。SupabaseでマイグレーションSQLを実行してください',
      );
    case '42501':
      return new AppError(
        503,
        '[DB_PERMISSION] データベースへのアクセス権限がありません。DATABASE_URLのDBユーザーと権限を確認してください',
      );
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return new AppError(
        503,
        '[DB_TLS] データベースの接続証明書を検証できません。接続先と信頼できるCA証明書の設定を確認してください',
      );
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
    case 'CONNECTION_TIMEOUT':
    case 'CONNECT_TIMEOUT':
      return new AppError(
        503,
        '[DB_CONNECT] データベースに接続できません。DATABASE_URLの接続先とネットワーク設定を確認し、時間をおいて再試行してください',
      );
    default:
      return null;
  }
}
