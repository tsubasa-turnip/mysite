import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as tls from 'node:tls';
import { AppError } from './validation';

const configMessage =
  '[DB_TLS_CONFIG] CA証明書の設定を読み込めません。DATABASE_SSL_CA または DATABASE_SSL_CA_FILE を確認してください';

export function databaseSSL(
  env: Record<string, string | undefined> = process.env,
): tls.ConnectionOptions {
  if (!env.DATABASE_SSL_CA && !env.DATABASE_SSL_CA_FILE) return { rejectUnauthorized: true };

  try {
    const value = env.DATABASE_SSL_CA || readFileSync(env.DATABASE_SSL_CA_FILE!, 'utf8');
    const pem = value
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .trim();
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (
      !blocks ||
      pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()
    )
      throw new Error('Invalid certificate bundle');
    const certificates = blocks.map((block) => new X509Certificate(block).toString());
    const defaults =
      typeof tls.getCACertificates === 'function'
        ? tls.getCACertificates('default')
        : tls.rootCertificates;
    return { rejectUnauthorized: true, ca: [...defaults, ...certificates] };
  } catch {
    // Do not attach the original error: it can include an environment value or path.
    throw new AppError(503, configMessage);
  }
}
