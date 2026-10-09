import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
  scryptSync,
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export function dataDirectory() {
  return process.env.INNER_WEATHER_DATA_DIR || path.join(process.cwd(), '.inner-weather');
}
function key() {
  if (process.env.DATA_ENCRYPTION_KEY) {
    if (!/^[a-f\d]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY))
      throw new Error('DATA_ENCRYPTION_KEY must be 32-byte hex');
    return Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex');
  }
  if (
    process.env.DATABASE_URL ||
    (process.env.NODE_ENV === 'production' && process.env.INNER_WEATHER_LOCAL !== '1')
  )
    throw new Error('Production requires DATA_ENCRYPTION_KEY');
  mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
  const file = path.join(dataDirectory(), 'encryption.key');
  try {
    return Buffer.from(readFileSync(file, 'utf8'), 'hex');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const k = randomBytes(32);
    try {
      writeFileSync(file, k.toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return key();
      throw e;
    }
    return k;
  }
}
export function seal(value: unknown) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return [
    'v1',
    iv.toString('base64'),
    c.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join('.');
}
export function open<T>(value: string): T {
  const [v, iv, tag, data] = value.split('.');
  if (v !== 'v1') throw new Error('Invalid encrypted record');
  const c = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  c.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(
    Buffer.concat([c.update(Buffer.from(data, 'base64')), c.final()]).toString('utf8'),
  );
}
export function hash(v: string | Uint8Array) {
  return createHash('sha256').update(v).digest('hex');
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function passwordMatches(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
