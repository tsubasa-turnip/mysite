import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { AppError } from './validation';
import { authProviderError } from './auth-errors';

const emailInput = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
});
const resetInput = z.object({
  access_token: z.string().min(1).max(8192),
  password: z.string().min(10).max(128),
});

function configuration() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new AppError(503, '[AUTH_RECOVERY] パスワード再設定にはSupabaseの認証設定が必要です');
  return {
    url,
    key,
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' },
    }),
  };
}

function returnUrl(origin: string) {
  try {
    const url = new URL(origin);
    const local =
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      (process.env.NODE_ENV !== 'production' || process.env.INNER_WEATHER_LOCAL === '1');
    if (
      url.origin !== origin ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    )
      throw new Error();
    return `${origin}/?password-reset=1`;
  } catch {
    throw new AppError(503, '[AUTH_RECOVERY] パスワード再設定の戻り先URLの設定を確認してください');
  }
}

function mailFailure(error: { code?: string; status?: number }) {
  const failure = authProviderError(error);
  return failure.status === 400
    ? new AppError(502, '[AUTH_EMAIL] 再設定メールの送信要求を完了できませんでした')
    : failure;
}

export async function requestPasswordReset(input: unknown, returnOrigin: string) {
  const { email } = emailInput.parse(input);
  const redirectTo = returnUrl(returnOrigin);
  const { client } = configuration();
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error && error.code !== 'user_not_found') throw mailFailure(error);
  // Provider data and account existence never enter this acknowledgment.
  return { accepted: true };
}

export async function resetPassword(input: unknown) {
  const { access_token, password } = resetInput.parse(input);
  const { client, url, key } = configuration();
  const { data, error } = await client.auth.getUser(access_token);
  if (error || typeof data?.user?.id !== 'string' || !data.user.id)
    throw new AppError(
      401,
      '[AUTH_RECOVERY] 再設定リンクが無効か、有効期限が切れています。再設定メールをもう一度依頼してください',
    );

  // The remote validation above proves identity; URL flags or decoded JWT
  // claims never authorize the change. This is the same Auth REST endpoint
  // used by updateUser, with no refresh-token storage or local DB mutation.
  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: key,
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
    cache: 'no-store',
  });
  if (!response.ok) {
    let code: unknown;
    try {
      const failure = await response.json();
      code = failure.error_code ?? failure.code;
    } catch {
      // Ignore raw/non-JSON provider bodies, which may contain private data.
    }
    if (response.status === 401 || response.status === 403)
      throw new AppError(
        401,
        '[AUTH_RECOVERY] 再設定リンクを確認できません。もう一度依頼してください',
      );
    if (code === 'weak_password')
      throw new AppError(400, '[AUTH_PASSWORD] より強いパスワードを設定してください');
    if (code === 'same_password')
      throw new AppError(400, '[AUTH_PASSWORD] 現在と異なるパスワードを設定してください');
    const failure = authProviderError({ code: typeof code === 'string' ? code : undefined });
    if (failure.status !== 400) throw failure;
    throw new AppError(
      502,
      '[AUTH_RECOVERY] パスワードを変更できませんでした。設定と接続を確認してください',
    );
  }
  (await cookies()).delete('iw_session');
  return { updated: true };
}
