import { expect, test } from '@playwright/test';

test('confirmation recovery clears stale notices and resends only on explicit request', async ({
  page,
}) => {
  const resendRequests: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/register') {
      await route.fulfill({ json: { verifyEmail: true } });
    } else if (path === '/api/auth/login') {
      await route.fulfill({
        status: 401,
        json: { error: 'メールアドレスまたはパスワードを確認してください' },
      });
    } else if (path === '/api/auth/resend-confirmation') {
      resendRequests.push(route.request().postDataJSON());
      await route.fulfill({ json: { accepted: true } });
    } else {
      // No real Auth request or email is sent, even for unexpected API calls.
      await route.fulfill({ status: 401, json: { error: 'ログインしてください' } });
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'おかえりなさい。' })).toBeVisible();
  await page.clock.install();
  const auth = page.locator('.auth-form');

  const resend = page.getByRole('button', { name: /^確認メールを再送/ });
  await expect(resend).toBeDisabled();
  await page.getByLabel('メールアドレス').fill('invalid-email');
  await expect(resend).toBeDisabled();
  await page.getByLabel('メールアドレス').fill('recovery@example.test');
  await expect(resend).toBeEnabled();

  await page.getByRole('button', { name: 'はじめての方はこちら' }).click();
  await page.getByLabel('パスワード', { exact: true }).fill('synthetic-recovery-password');
  await page.getByRole('button', { name: 'アカウントを作成', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('メール確認が必要な場合');
  await expect(page.getByRole('status')).toContainText('すでに確認済みの場合');
  await expect(page.getByRole('status')).not.toContainText('送信しました');
  expect(resendRequests).toEqual([]);

  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(auth.getByRole('alert')).toContainText('メールアドレスまたはパスワード');
  await expect(page.getByRole('status')).toHaveCount(0);

  await resend.click();
  await expect(auth.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('確認が必要なアカウントの場合');
  await expect(page.getByRole('status')).not.toContainText('送信しました');
  expect(resendRequests).toEqual([{ email: 'recovery@example.test' }]);
  await expect(resend).toBeDisabled();
  await expect(resend).toContainText('あと');

  await page.getByRole('button', { name: 'はじめての方はこちら' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(resend).toBeDisabled();
  await page.getByRole('button', { name: 'すでにアカウントをお持ちの方' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(resendRequests).toHaveLength(1);

  await page.clock.fastForward(60000);
  await expect(resend).toBeEnabled();
  expect(resendRequests).toHaveLength(1);
});
