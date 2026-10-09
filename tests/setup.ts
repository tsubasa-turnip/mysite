// Unit/integration tests always use an isolated engine, never configured customer services.
for (const name of [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'IW_OPENAI_API_KEY',
])
  delete process.env[name];
process.env.INNER_WEATHER_DB = 'memory';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error(
      'External network is forbidden in unit tests; explicitly mock synthetic API responses',
    );
  return realFetch(input, options);
};
