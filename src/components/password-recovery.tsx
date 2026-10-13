'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CloudSun } from 'lucide-react';
import { send } from '@/lib/client';
import { Button } from '@/components/ui/button';

const invalidLink =
  '再設定リンクの有効期限が切れているか、正しくありません。再設定メールをもう一度リクエストしてください。';
const acknowledged =
  'このメールアドレスにアカウントがある場合、再設定メールが届きます。迷惑メールフォルダも確認してください。届かない場合は、しばらく待ってから再度お試しください。';

// Provider text can contain credentials. Only our predefined messages are shown.
function recoveryError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('[AUTH_RECOVERY]')) {
    if (
      message.includes('認証設定') ||
      message.includes('設定と接続') ||
      message.includes('戻り先URLの設定') ||
      message.includes('接続')
    )
      return '[AUTH_RECOVERY] パスワードを再設定できません。アプリの認証設定と接続を確認してください。';
    return invalidLink;
  }
  if (message.includes('[AUTH_EMAIL]'))
    return '[AUTH_EMAIL] 再設定メールを送信できません。アプリのメール送信設定を確認してください。';
  if (message.includes('試行回数') || message.includes('時間をおいて'))
    return '認証の試行回数が上限に達しました。少し時間をおいてからお試しください。';
  if (message.includes('[AUTH_PASSWORD]') && message.includes('より強い'))
    return '英字・数字・記号を組み合わせた、より強いパスワードを設定してください。';
  if (message.includes('10文字') || message.includes('[AUTH_PASSWORD]'))
    return '新しいパスワードは10〜128文字で入力してください。以前と異なるパスワードを選んでください。';
  return '再設定を完了できませんでした。時間をおいて、再度お試しください。';
}

function RecoveryShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page" style={{ gridTemplateColumns: '1fr' }}>
      <div className="auth-form-wrap" style={{ minHeight: '100dvh' }}>
        <div className="auth-form">
          <CloudSun size={35} strokeWidth={1.2} aria-hidden="true" />
          {children}
        </div>
      </div>
    </main>
  );
}

export function PasswordRecoveryRequest({
  onBack,
  initialEmail = '',
  initialError = '',
}: {
  onBack?: () => void;
  initialEmail?: string;
  initialError?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const cooldownUntil = useRef(0);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(
      () => setCooldown(Math.max(0, Math.ceil((cooldownUntil.current - Date.now()) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || cooldown || !validEmail) return;
    setBusy(true);
    setError('');
    setMessage('');
    cooldownUntil.current = Date.now() + 60000;
    setCooldown(60);
    try {
      await send('auth/password-reset-email', { email: email.trim() });
      setMessage(acknowledged);
    } catch (failure) {
      setError(recoveryError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecoveryShell>
      <h2>パスワードを忘れた方へ</h2>
      <p>登録したメールアドレスに、パスワードを再設定するためのリンクをお送りします。</p>
      <form onSubmit={requestReset}>
        <label>
          メールアドレス
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </label>
        <Button type="submit" disabled={busy || !validEmail || cooldown > 0}>
          {busy
            ? 'リクエストしています…'
            : cooldown > 0
              ? `再設定メールを送る（あと${cooldown}秒）`
              : '再設定メールを送る'}
        </Button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
      </form>
      {onBack ? (
        <button className="text-link auth-switch" disabled={busy} onClick={onBack}>
          ログインに戻る
        </button>
      ) : (
        <a className="text-link auth-switch" href="/">
          ログインに戻る
        </a>
      )}
    </RecoveryShell>
  );
}

export function PasswordRecoveryGate({ children }: { children: ReactNode }) {
  const initialized = useRef(false);
  const accessToken = useRef<string | null>(null);
  const generation = useRef(0);
  const [mode, setMode] = useState<'loading' | 'app' | 'reset' | 'invalid' | 'success'>('loading');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function readFragment() {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const url = new URL(window.location.href);
      const recovery =
        fragment.get('type') === 'recovery' || url.searchParams.get('password-reset') === '1';
      const hasCredentials = [
        'access_token',
        'refresh_token',
        'error',
        'error_code',
        'error_description',
        'type',
      ].some((key) => fragment.has(key));
      if (initialized.current && !hasCredentials && !recovery) return;
      initialized.current = true;
      generation.current++;
      // A new link can arrive through same-document hash navigation in a reused
      // iPhone tab. Scrub it before UI changes and invalidate previous requests.
      if (hasCredentials || recovery)
        window.history.replaceState(window.history.state, '', url.pathname + url.search);
      accessToken.current = null;
      setPassword('');
      setConfirmation('');
      setError('');
      setBusy(false);
      if (!recovery) {
        setMode('app');
        return;
      }
      const token = fragment.get('access_token');
      const failed =
        fragment.has('error') || fragment.has('error_code') || fragment.has('error_description');
      if (!token || token.length > 8192 || failed) {
        setMode('invalid');
        return;
      }
      accessToken.current = token;
      setMode('reset');
    }
    if (!initialized.current) readFragment();
    window.addEventListener('hashchange', readFragment);
    return () => window.removeEventListener('hashchange', readFragment);
  }, []);

  function returnToLogin() {
    generation.current++;
    accessToken.current = null;
    setPassword('');
    setConfirmation('');
    setError('');
    const url = new URL(window.location.href);
    url.searchParams.delete('password-reset');
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
    setMode('app');
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (password.length < 10 || password.length > 128) {
      setError('新しいパスワードは10〜128文字で入力してください。');
      return;
    }
    if (password !== confirmation) {
      setError('確認用のパスワードが一致しません。');
      return;
    }
    if (!accessToken.current) {
      setPassword('');
      setConfirmation('');
      setMode('invalid');
      return;
    }
    setBusy(true);
    const requestGeneration = generation.current;
    try {
      await send('auth/password-reset', { access_token: accessToken.current, password });
      if (requestGeneration !== generation.current) return;
      accessToken.current = null;
      setPassword('');
      setConfirmation('');
      setMode('success');
    } catch (failure) {
      if (requestGeneration !== generation.current) return;
      const safeError = recoveryError(failure);
      setPassword('');
      setConfirmation('');
      if (safeError === invalidLink) {
        accessToken.current = null;
        setMode('invalid');
      } else setError(safeError);
    } finally {
      if (requestGeneration === generation.current) setBusy(false);
    }
  }

  if (mode === 'app') return children;
  if (mode === 'loading')
    return (
      <div className="loading-screen" role="status">
        準備しています…
      </div>
    );
  if (mode === 'invalid')
    return <PasswordRecoveryRequest onBack={returnToLogin} initialError={invalidLink} />;
  if (mode === 'success')
    return (
      <RecoveryShell>
        <h2>パスワードを再設定しました</h2>
        <p role="status">新しいパスワードでログインしてください。</p>
        <Button onClick={returnToLogin}>ログインに戻る</Button>
      </RecoveryShell>
    );
  return (
    <RecoveryShell>
      <h2>新しいパスワードを設定</h2>
      <p>10〜128文字で、これまでと異なるパスワードを設定してください。</p>
      <form onSubmit={resetPassword}>
        <label>
          新しいパスワード
          <input
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          新しいパスワード（確認）
          <input
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            value={confirmation}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          disabled={
            busy || password.length < 10 || password.length > 128 || confirmation.length < 10
          }
        >
          {busy ? '再設定しています…' : 'パスワードを再設定'}
        </Button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <button className="text-link auth-switch" disabled={busy} onClick={returnToLogin}>
        ログインに戻る
      </button>
    </RecoveryShell>
  );
}
