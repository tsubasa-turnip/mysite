import { test, expect } from '@playwright/test';
import { zipSync } from 'fflate';
import { fixtureBytes } from '../fixtures';
test('iPhone: journal CRUD, ZIP preview/consent/import, correction, graph, source links, reflection, privacy', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'Inner Weather',
  );
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    const png = await response.body();
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  const appleIconURL = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await page.request.get(appleIconURL!)).ok()).toBe(true);
  await page.getByRole('button', { name: 'はじめての方はこちら' }).click();
  await page.getByLabel('呼ばれたい名前').fill('天気のテスト');
  await page.getByLabel('メールアドレス').fill(`iphone-${Date.now()}@example.test`);
  await page.getByLabel('パスワード', { exact: true }).fill('synthetic-test-password');
  await page.getByRole('button', { name: 'アカウントを作成', exact: true }).click();
  await expect(page.getByRole('heading', { name: /今日は、どんな心の天気/ })).toBeVisible();
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('日記', { exact: true })
    .fill('今日は仕事で不安だった。散歩で回復し、つながりが大切だと気づいた。');
  await dialog.getByRole('button', { name: '録音する', exact: true }).click();
  await expect(dialog.getByText('録音中', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '録音を停止', exact: true }).click();
  await expect(dialog.locator('audio')).toHaveAttribute('src', /^blob:/);
  await expect(dialog.getByRole('button', { name: '文字起こしする', exact: true })).toBeDisabled();
  await dialog.getByLabel('出来事の日付').fill('2026-10-04');
  await dialog.getByLabel('不安', { exact: true }).check();
  await dialog.getByLabel('不安の強さ').fill('0');
  await dialog.getByLabel('アンカーとして、大切な瞬間を残す').check();
  await dialog.getByRole('button', { name: '日記を保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: '記録', exact: true })
    .click();
  await expect(page.locator('.journal-card')).toHaveCount(1);
  await expect(page.locator('.emotion-tags')).toContainText('不安 0');
  await page.getByRole('button', { name: '日記を編集', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('日記', { exact: true })
    .fill('仕事で不安だった。散歩で回復した。修正済みの記録。');
  await page.getByRole('button', { name: '日記を保存', exact: true }).click();
  await expect(page.locator('.journal-card')).toContainText('修正済み');
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: 'インポート', exact: true })
    .click();
  await page.locator('input[type=file][accept=".zip,.json"]').setInputFiles({
    name: 'chatgpt-export.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync({ 'conversations.json': fixtureBytes() })),
  });
  await expect(page.getByRole('heading', { name: '保存前のプレビュー' })).toBeVisible();
  await expect(page.getByRole('button', { name: '確認してインポートを開始' })).toBeDisabled();
  await page.getByLabel(/選択した1件の会話原文を保存/).check();
  await page.getByRole('button', { name: '確認してインポートを開始' }).click();
  await expect(page.locator('.job-card')).toContainText('完了', { timeout: 30000 });
  await page.getByRole('tab', { name: /確認・修正/ }).click();
  await expect(page.locator('.candidate')).toHaveCount(2);
  await page.locator('.candidate').first().getByRole('button', { name: '確認・修正する' }).click();
  const review = page.getByRole('dialog');
  await review.getByLabel('出来事の日付').fill('2026-10-04');
  await review.getByLabel('穏やか', { exact: true }).check();
  await review.getByLabel('穏やかの強さ').fill('8');
  await review.getByRole('button', { name: '確認して日記に保存' }).click();
  await expect(page.locator('.candidate').first()).toContainText('確認済み');
  await page.locator('.candidate').first().getByRole('button', { name: '原文を見る' }).click();
  await expect(page.getByRole('dialog')).toContainText('あなた');
  await expect(page.getByRole('dialog')).toContainText('ChatGPT');
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: '心の天気図' })
    .click();
  await page.getByLabel('表示期間の最終日').fill('2026-10-08');
  await expect(page.locator('.graph-panel')).toContainText('確認済みの日記 2件');
  await expect(page.locator('.recharts-surface')).toBeVisible();
  await page.getByRole('button', { name: '週次の振り返り' }).click();
  await expect(page.locator('.insight-card')).toHaveCount(1);
  await expect(page.locator('.insight-card .source-card')).not.toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: '振り返る', exact: true })
    .click();
  await page.getByLabel('過去の自分への質問').fill('仕事の不安からどう回復した？');
  await page.getByRole('button', { name: '質問を送信' }).click();
  await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
  await page.locator('.chat-message.assistant .source-card').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: '設定', exact: true })
    .click();
  await page.getByRole('button', { name: 'ダークモードにする' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'ライトモードにする' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole('navigation', { name: 'メインナビゲーション' })
    .getByRole('button', { name: 'ホーム', exact: true })
    .click();
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/home-iphone.png', fullPage: true });
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: '記録', exact: true })
    .click();
  await page
    .locator('.journal-card')
    .filter({ hasText: '修正済み' })
    .getByRole('button', { name: '日記を削除' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await expect(page.locator('.journal-card')).toHaveCount(1);
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: '設定', exact: true })
    .click();
  await page.getByRole('button', { name: 'すべての記録を削除する' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'モバイルナビゲーション' })
    .getByRole('button', { name: '記録', exact: true })
    .click();
  await expect(page.locator('.journal-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('API authorization, CSRF, file limits, consent and user isolation', async ({ browser }) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const origin = 'http://127.0.0.1:3100';
  for (const [ctx, prefix] of [
    [a, 'api-a'],
    [b, 'api-b'],
  ] as const) {
    const r = await ctx.request.post('/api/auth/register', {
      headers: { origin },
      data: { email: `${prefix}-${Date.now()}@example.test`, password: 'synthetic-test-password' },
    });
    expect(r.ok()).toBe(true);
  }
  const entry = await a.request.post('/api/journals', {
    headers: { origin },
    data: {
      text: '私のプライベートな記録',
      event_date: '2026-10-04',
      date_kind: 'explicit',
      emotions: { joy: 0 },
    },
  });
  expect(entry.ok()).toBe(true);
  const { id } = await entry.json();
  expect(await (await b.request.get('/api/journals')).json()).toEqual([]);
  expect(
    (
      await b.request.patch('/api/journals/' + id, {
        headers: { origin },
        data: { text: 'overwrite' },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await a.request.delete('/api/journals/' + id, { headers: { origin: 'https://evil.example' } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await a.request.post('/api/imports', {
        headers: { origin },
        multipart: {
          file: {
            name: 'x.json',
            mimeType: 'application/json',
            buffer: Buffer.from(fixtureBytes()),
          },
          selected: '["conversation-1"]',
          method: 'local',
          confirmed: 'false',
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await a.request.post('/api/reflect', {
        headers: { origin },
        data: { question: '仕事', method: 'openai', consent: false },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await a.request.post('/api/imports/preview', {
        headers: { origin },
        multipart: {
          file: {
            name: 'oversize.json',
            mimeType: 'application/json',
            buffer: Buffer.alloc(26 * 1024 * 1024),
          },
        },
      })
    ).status(),
  ).toBe(413);
  const exported = await a.request.get('/api/data/export');
  expect(exported.ok()).toBe(true);
  const data = await exported.json();
  expect(JSON.stringify(data)).not.toContain('password_hash');
  expect(data.journal_entries[0].content.text).toBe('私のプライベートな記録');
  expect(
    (
      await a.request.post('/api/worker', { headers: { Authorization: 'Bearer invalid' } })
    ).status(),
  ).toBe(401);
  await a.close();
  await b.close();
});
