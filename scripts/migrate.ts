import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { databaseSSL } from '../src/lib/database-ssl';
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL)
  throw new Error('Set DATABASE_URL to a privileged Supabase PostgreSQL connection');
const sql = postgres(process.env.DATABASE_URL, {
  ssl: databaseSSL(),
  prepare: false,
  max: 1,
});
await sql.unsafe(await readFile('supabase/migrations/001_inner_weather.sql', 'utf8'));
await sql.end();
console.log('Migration applied.');
