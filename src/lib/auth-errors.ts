import { AppError } from './validation';

type ProviderError = { code?: string; status?: number };

// Only provider codes select predefined messages. Never surface provider text,
// which may contain an email address, credentials, or other sensitive values.
export function authProviderError(error: ProviderError): AppError {
  switch (error.code) {
    case 'email_not_confirmed':
      return new AppError(
        401,
        'メールアドレスの確認が必要です。確認メールのリンクを開いてから、ログインしてください',
      );
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
    case 'over_sms_send_rate_limit':
      return new AppError(429, '認証の試行回数が上限に達しました。少し時間をおいてからお試しください');
    case 'signup_disabled':
    case 'email_provider_disabled':
      return new AppError(503, '現在、メールでの認証を利用できません。アプリの認証設定を確認してください');
    case 'invalid_credentials':
      return new AppError(401, 'メールアドレスまたはパスワードを確認してください');
    default:
      return new AppError(400, '認証できませんでした。メールアドレスとパスワードを確認してください');
  }
}
