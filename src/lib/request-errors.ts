const exactRoutes = new Map([
  ['auth/login', 'IW_AUTH_LOGIN'],
  ['auth/register', 'IW_AUTH_REGISTER'],
  ['auth/resend-confirmation', 'IW_AUTH_EMAIL'],
  ['me', 'IW_PROFILE'],
  ['profile', 'IW_PROFILE'],
]);

const subsystems = new Map([
  ['journals', 'IW_JOURNALS'],
  ['candidates', 'IW_CANDIDATES'],
  ['imports', 'IW_IMPORTS'],
  ['conversations', 'IW_CONVERSATIONS'],
  ['messages', 'IW_MESSAGES'],
  ['insights', 'IW_INSIGHTS'],
  ['reflect', 'IW_REFLECT'],
]);

/** Returns only fixed subsystem codes; request paths never enter the response. */
export function unexpectedRequestError(route: string): { error: string; diagnostic: string } {
  const safeRoute = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(route);
  const diagnostic = safeRoute
    ? (exactRoutes.get(route) ?? subsystems.get(route.split('/')[0]) ?? 'IW_SERVER')
    : 'IW_SERVER';
  return {
    error: `[${diagnostic}] 処理を完了できませんでした。設定と接続を確認してください`,
    diagnostic,
  };
}
