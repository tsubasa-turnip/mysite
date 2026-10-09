import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL)
  throw new Error('Set DATABASE_URL to a privileged Supabase PostgreSQL connection');
const sql = postgres(process.env.DATABASE_URL, {
  ssl: {
    rejectUnauthorized: true,
    ...(process.env.DATABASE_SSL_CA_FILE
      ? { ca: readFileSync(process.env.DATABASE_SSL_CA_FILE) }
      : {}),
  },
  prepare: false,
  max: 1,
});
await sql.unsafe(await readFile('supabase/migrations/001_inner_weather.sql', 'utf8'));
await sql.end();
console.log('Migration applied.');
