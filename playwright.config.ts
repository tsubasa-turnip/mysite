import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: [
        '--no-sandbox',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  projects: [{ name: 'iPhone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: {
    command: `DATABASE_URL='' SUPABASE_URL='' SUPABASE_ANON_KEY='' SUPABASE_SERVICE_ROLE_KEY='' OPENAI_API_KEY='' IW_OPENAI_API_KEY='' DATA_ENCRYPTION_KEY='' MAX_UPLOAD_MB=25 INNER_WEATHER_LOCAL=1 INNER_WEATHER_DATA_DIR=/tmp/inner-weather-e2e APP_ORIGIN=http://127.0.0.1:3100 npm run start -- -p 3100`,
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
