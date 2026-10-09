import { AppError } from './validation';

type Environment = Record<string, string | undefined>;

function exactOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

function platformOrigin(host: string | undefined): string | null {
  if (!host) return null;
  try {
    const url = new URL(`https://${host}`);
    if (
      url.host.toLowerCase() !== host.toLowerCase() ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function assertRequestOrigin(request: Request, env: Environment = process.env) {
  if (request.method === 'GET') return;

  const allowed = new Set<string>();
  if (env.APP_ORIGIN) {
    const configured = exactOrigin(env.APP_ORIGIN);
    if (!configured) throw new AppError(503, 'アプリの公開URL設定を確認してください');
    allowed.add(configured);
  }
  if (env.VERCEL) {
    // These values are supplied by Vercel for this project. Never accept a
    // wildcard vercel.app origin or derive trust from client-controlled headers.
    for (const name of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
      const platform = platformOrigin(env[name]);
      if (platform) allowed.add(platform);
    }
  }
  if (!env.APP_ORIGIN && !env.VERCEL) {
    if (env.NODE_ENV === 'production' && env.INNER_WEATHER_LOCAL !== '1')
      throw new AppError(503, 'アプリの公開URL設定を確認してください');
    allowed.add(new URL(request.url).origin);
  }

  const actual = request.headers.get('origin');
  if (!actual || !allowed.has(actual)) throw new AppError(403, 'リクエスト元を確認できません');
}
