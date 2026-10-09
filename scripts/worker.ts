import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL)
  throw new Error(
    'The separate worker requires DATABASE_URL. Local PGlite is single-process; use the in-app resumable processing instead.',
  );
const { runWorkerTick } = await import('../src/lib/imports');
let stopped = false;
process.on('SIGTERM', () => {
  stopped = true;
});
process.on('SIGINT', () => {
  stopped = true;
});
console.log('Inner Weather worker started. No journal content is logged.');
while (!stopped) {
  try {
    await runWorkerTick();
  } catch {
    console.error('Worker tick failed; retrying. Check database and service configuration.');
  }
  await new Promise((r) => setTimeout(r, 2000));
}
