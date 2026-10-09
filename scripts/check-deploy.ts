// Offline preflight: validate settings without sending any data or logging secret values.
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });

const problems: string[] = [];
for (const name of [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'DATA_ENCRYPTION_KEY',
  'APP_ORIGIN',
]) {
  if (!process.env[name]) problems.push(`${name}: 未設定`);
}
function checkURL(name: string, allowed: string[]) {
  const value = process.env[name];
  if (!value) return;
  try {
    const url = new URL(value);
    if (!allowed.includes(url.protocol)) throw new Error();
    if (
      name !== 'DATABASE_URL' &&
      (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    )
      throw new Error();
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
    if (name === 'APP_ORIGIN' && url.origin !== value) throw new Error();
  } catch {
    problems.push(`${name}: 公開先の正しいURLが必要です`);
  }
}
checkURL('DATABASE_URL', ['postgres:', 'postgresql:']);
checkURL('SUPABASE_URL', ['https:']);
checkURL('APP_ORIGIN', ['https:']);
if (process.env.DATA_ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY))
  problems.push('DATA_ENCRYPTION_KEY: 64桁の16進数が必要です');
if (process.env.INNER_WEATHER_LOCAL === '1')
  problems.push('INNER_WEATHER_LOCAL: 公開環境では削除してください');
if (process.env.VERCEL && Number(process.env.MAX_UPLOAD_MB || 25) > 4)
  problems.push('MAX_UPLOAD_MB: Vercelでは4以下に設定してください');

if (problems.length) {
  console.error('デプロイ前の設定確認に失敗しました。値は表示していません。');
  for (const problem of problems) console.error(`- ${problem}`);
  console.error('手順: docs/IPHONE_SETUP.md');
  process.exit(2);
}
console.log('必須設定の形式を確認しました。実接続・マイグレーションは別途検証が必要です。');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.log('任意設定: SUPABASE_SERVICE_ROLE_KEY未設定のため、アカウント完全削除は使えません。');
if (!process.env.OPENAI_API_KEY && !process.env.IW_OPENAI_API_KEY)
  console.log('任意設定: OpenAI未設定。外部送信なしの候補抽出・振り返りで利用できます。');
