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
    case 'ENETUNREACH':
    case 'ECONNRESET':
    case 'EPIPE':
    case 'ERR_SOCKET_CONNECTION_TIMEOUT':
    case 'CONNECTION_TIMEOUT':
    case 'CONNECT_TIMEOUT':
    case 'CONNECTION_CLOSED':
    case 'CONNECTION_ENDED':
    case 'CONNECTION_DESTROYED':
    case '08000':
    case '08003':
    case '08006':
    case '08001':
    case '08004':
    case '57P03':
      return new AppError(
        503,
        '[DB_CONNECT] データベースに接続できません。DATABASE_URLの接続先とネットワーク設定を確認し、時間をおいて再試行してください',
      );
    case '53300':
      return new AppError(
        503,
        '[DB_CONNECT] データベースの同時接続数が上限に達しました。時間をおいて再試行してください',
      );
    case 'XX000': {
      let message: unknown;
      try {
        message = (error as { message?: unknown }).message;
      } catch {
        // The known code still permits a safe generic response if message access fails.
      }
      // Supavisor uses XX000 for both tenant lookup failures and other internal errors.
      // Only these provider-defined messages identify the tenant lookup failure.
      const tenantNotFound =
        message === 'Tenant or user not found' ||
        (typeof message === 'string' &&
          message.trim() === message &&
          /^\(ENOTFOUND\) tenant\/user [^\s]+ not found$/.test(message));
      return new AppError(
        503,
        tenantNotFound
          ? '[DB_POOLER] SupabaseのTransaction poolerで接続先またはDBユーザーが見つかりません。DATABASE_URLの接続先とDBユーザー名（postgres.<project-ref>）を確認してください'
          : '[DB_SERVER] データベースまたは接続プーラーで内部エラーが発生しました。Supabaseの稼働状況と接続設定を確認してください',
      );
    }
    default:
      return null;
  }
}
