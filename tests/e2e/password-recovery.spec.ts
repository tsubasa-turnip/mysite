import { expect, test, type Page } from '@playwright/test';

const recoveryToken = 'synthetic-recovery-access-token';
const refreshToken = 'synthetic-recovery-refresh-token';
const newPassword = 'synthetic-new-password';

async function mockRecovery(page: Page, resetError?: string) {
  const resetRequests: Record<string, unknown>[] = [];
  const emailRequests: Record<string, unknown>[] = [];
  const urlsAtSubmission: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/password-reset') {
      urlsAtSubmission.push(page.url());
      resetRequests.push(route.request().postDataJSON());
      await route.fulfill(
        resetError ? { status: 401, json: { error: resetError } } : { json: { accepted: true } },
      );
    } else if (path === '/api/auth/password-reset-email') {
      urlsAtSubmission.push(page.url());
      emailRequests.push(route.request().postDataJSON());
      await route.fulfill({ json: { accepted: true } });
    } else {
      // All Auth calls are synthetic, including the normal login screen bootstrap.
      await route.fulfill({ status: 401, json: { error: 'ログインしてください' } });
    }
  });
  return { resetRequests, emailRequests, urlsAtSubmission };
}

test('forgot password sends only on request, acknowledges conditionally, and waits before retry', async ({
  page,
}) => {
  const { emailRequests, resetRequests } = await mockRecovery(page);
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill('recovery@example.test');
  await page.getByRole('button', { name: 'パスワードを忘れた方', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'パスワードを忘れた方へ' })).toBeVisible();
  await expect(page.getByLabel('メールアドレス')).toHaveValue('recovery@example.test');
  expect(emailRequests).toEqual([]);
  expect(resetRequests).toEqual([]);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.clock.install();

  const request = page.getByRole('button', { name: /^再設定メールを送る/ });
  await page.getByLabel('メールアドレス').fill('invalid-email');
  await expect(request).toBeDisabled();
  await page.getByLabel('メールアドレス').fill('recovery@example.test');
  await request.click();
  await expect(page.getByRole('status')).toContainText('アカウントがある場合');
  await expect(page.getByRole('status')).not.toContainText('送信しました');
  expect(emailRequests).toEqual([{ email: 'recovery@example.test' }]);
  await expect(request).toBeDisabled();
  await page.clock.fastForward(60000);
  await expect(request).toBeEnabled();
  expect(emailRequests).toHaveLength(1);
  await page.getByRole('button', { name: 'ログインに戻る' }).click();
  await expect(page.getByRole('heading', { name: 'おかえりなさい。' })).toBeVisible();
});

test('recovery fragment is scrubbed before rendering or submission and tokens never persist', async ({
  page,
}) => {
  const output: string[] = [];
  page.on('console', (message) => output.push(message.text()));
  page.on('pageerror', (error) => output.push(error.message));
  const { emailRequests, resetRequests, urlsAtSubmission } = await mockRecovery(page);
  await page.goto(
    `/?password-reset=1#type=recovery&access_token=${recoveryToken}&refresh_token=${refreshToken}&expires_in=3600`,
  );
  await expect(page.getByRole('heading', { name: '新しいパスワードを設定' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(emailRequests).toEqual([]);
  expect(resetRequests).toEqual([]);
  await expect(page.getByRole('heading', { name: 'おかえりなさい。' })).toHaveCount(0);
  const privateClientState = () =>
    page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
      url: location.href,
    }));
  let snapshot = JSON.stringify(await privateClientState());
  expect(snapshot).not.toContain(recoveryToken);
  expect(snapshot).not.toContain(refreshToken);

  const submit = page.getByRole('button', { name: 'パスワードを再設定', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel('新しいパスワード', { exact: true }).fill(newPassword);
  await page.getByLabel('新しいパスワード（確認）', { exact: true }).fill('synthetic-not-matching');
  await submit.click();
  await expect(page.locator('.auth-form').getByRole('alert')).toContainText('一致しません');
  expect(resetRequests).toEqual([]);
  await page.getByLabel('新しいパスワード（確認）', { exact: true }).fill(newPassword);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'パスワードを再設定しました' })).toBeVisible();
  expect(resetRequests).toEqual([{ access_token: recoveryToken, password: newPassword }]);
  expect(urlsAtSubmission.every((url) => !new URL(url).hash)).toBe(true);
  expect(JSON.stringify(resetRequests)).not.toContain(refreshToken);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  snapshot = JSON.stringify(await privateClientState());
  expect(snapshot).not.toContain(recoveryToken);
  expect(snapshot).not.toContain(refreshToken);
  expect(snapshot).not.toContain(newPassword);
  expect(output.join('\n')).not.toContain(recoveryToken);
  expect(output.join('\n')).not.toContain(refreshToken);
  await page.getByRole('button', { name: 'ログインに戻る' }).click();
  await expect(page.getByRole('heading', { name: 'おかえりなさい。' })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('password-reset')).toBe(false);
});

test('missing or expired recovery links show safe restart flow without displaying provider details', async ({
  page,
}) => {
  const { resetRequests, emailRequests } = await mockRecovery(page);
  await page.goto('/?password-reset=1');
  await expect(page.locator('.auth-form').getByRole('alert')).toContainText(
    '再設定リンクの有効期限',
  );
  expect(resetRequests).toEqual([]);
  expect(emailRequests).toEqual([]);
  const privateDescription = 'private-provider-description-user@example.test';
  await page.goto(
    `/?password-reset=1#error=access_denied&error_code=otp_expired&error_description=${privateDescription}&refresh_token=${refreshToken}`,
  );
  await expect(page.getByRole('heading', { name: 'パスワードを忘れた方へ' })).toBeVisible();
  await expect(page.locator('.auth-form').getByRole('alert')).toContainText('もう一度リクエスト');
  expect(page.url()).not.toContain('#');
  expect(await page.locator('body').textContent()).not.toContain(privateDescription);
  expect(await page.locator('body').textContent()).not.toContain(refreshToken);
  expect(resetRequests).toEqual([]);
  expect(emailRequests).toEqual([]);
});

test('server rejection of expired token clears the recovery form and requests a fresh link', async ({
  page,
}) => {
  const { resetRequests, emailRequests } = await mockRecovery(
    page,
    '[AUTH_RECOVERY] 再設定リンクが無効か、有効期限が切れています。再設定メールをもう一度依頼してください',
  );
  await page.goto(`/?password-reset=1#type=recovery&access_token=${recoveryToken}`);
  await page.getByLabel('新しいパスワード', { exact: true }).fill(newPassword);
  await page.getByLabel('新しいパスワード（確認）', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'パスワードを再設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'パスワードを忘れた方へ' })).toBeVisible();
  await expect(page.locator('.auth-form').getByRole('alert')).toContainText('もう一度リクエスト');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  expect(resetRequests).toHaveLength(1);
  expect(emailRequests).toEqual([]);
});
