export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/' + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '処理を完了できません');
  return value;
}
export function send(path: string, body: unknown, method = 'POST') {
  return api(path, { method, body: JSON.stringify(body) });
}
