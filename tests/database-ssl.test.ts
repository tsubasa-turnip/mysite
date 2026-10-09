import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as tls from 'node:tls';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseSSL } from '../src/lib/database-ssl';
import { AppError } from '../src/lib/validation';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const certificate = tls.rootCertificates[0];
const canonicalCertificate = new X509Certificate(certificate).toString();

beforeEach(() => {
  vi.mocked(readFileSync).mockReset();
});

describe('verified database TLS configuration', () => {
  it('uses default trusted roots and requires certificate verification without a custom CA', () => {
    expect(databaseSSL({})).toEqual({ rejectUnauthorized: true });
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it.each([certificate, certificate.replace(/\n/g, '\\n')])(
    'accepts actual or escaped certificate newlines while retaining the default trust store',
    (pem) => {
      const options = databaseSSL({ DATABASE_SSL_CA: pem });
      expect(options.rejectUnauthorized).toBe(true);
      const defaultRoots =
        typeof tls.getCACertificates === 'function'
          ? tls.getCACertificates('default')
          : tls.rootCertificates;
      expect(options.ca).toEqual([...defaultRoots, canonicalCertificate]);
      expect(readFileSync).not.toHaveBeenCalled();
    },
  );

  it('retains file-based CA configuration', () => {
    vi.mocked(readFileSync).mockReturnValue(certificate);
    const options = databaseSSL({ DATABASE_SSL_CA_FILE: '/synthetic/ca.pem' });
    expect(readFileSync).toHaveBeenCalledWith('/synthetic/ca.pem', 'utf8');
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.ca).toContain(canonicalCertificate);
  });

  it('prefers inline PEM and never reads the configured file when inline PEM exists', () => {
    const options = databaseSSL({
      DATABASE_SSL_CA: certificate,
      DATABASE_SSL_CA_FILE: '/synthetic/unused.pem',
    });
    expect(options.ca).toContain(canonicalCertificate);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it.each([
    'synthetic-invalid-PEM',
    '-----BEGIN CERTIFICATE-----\ninvalid-base64\n-----END CERTIFICATE-----',
    '-----BEGIN PRIVATE KEY-----\nsynthetic-private-key\n-----END PRIVATE KEY-----',
    `${certificate}\n-----BEGIN PRIVATE KEY-----\nsynthetic-private-key\n-----END PRIVATE KEY-----`,
    `${certificate}\nsynthetic-trailing-content`,
    '   ',
  ])('rejects invalid or non-certificate PEM without exposing its content', (pem) => {
    let error: unknown;
    try {
      databaseSSL({ DATABASE_SSL_CA: pem });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 503 });
    expect((error as Error).message).toContain('[DB_TLS_CONFIG]');
    if (pem.trim()) expect((error as Error).message).not.toContain(pem);
    expect(error).not.toHaveProperty('cause');
  });

  it('hides file paths, file errors, and secrets without logging them', () => {
    const filename = '/synthetic/private-path/ca.pem';
    const secret = 'synthetic-sensitive-secret';
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error(`Cannot read ${filename}: ${secret}`);
    });
    const logs = ['log', 'warn', 'error'].map((name) =>
      vi.spyOn(console, name as 'log' | 'warn' | 'error').mockImplementation(() => {}),
    );
    try {
      let error: unknown;
      try {
        databaseSSL({ DATABASE_SSL_CA_FILE: filename });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 503 });
      const output = `${(error as Error).message}\n${(error as Error).stack}`;
      expect(output).not.toContain(filename);
      expect(output).not.toContain(secret);
      expect(error).not.toHaveProperty('cause');
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });
});
