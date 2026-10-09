'use client';
import { useState } from 'react';
import { Shield, Download, Trash2, LogOut, Moon, Sun } from 'lucide-react';
import { send } from '@/lib/client';
import { Button } from './ui/button';
export function SettingsPanel({
  profile,
  email,
  dark,
  setDark,
  onRefresh,
  onDelete,
  onAccount,
  onLogout,
}: {
  profile: any;
  email: string;
  dark: boolean;
  setDark: (v: boolean) => void;
  onRefresh: () => Promise<void>;
  onDelete: () => void;
  onAccount: () => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(profile.display_name),
    [timezone, setTimezone] = useState(profile.timezone),
    [consent, setConsent] = useState(profile.ai_consent),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await send('profile', { display_name: name, timezone, ai_consent: consent }, 'PATCH');
      await onRefresh();
      setMessage('設定を保存しました');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SPACE, YOUR CHOICE</span>
          <h1>安心して、記録するために。</h1>
          <p>あなたの言葉の扱い方を、あなたが選べます。</p>
        </div>
        <Shield size={32} className="heading-icon" />
      </div>
      <form onSubmit={save}>
        <div className="panel settings-card">
          <h2>プロフィール</h2>
          <p className="small muted">
            {email} ·{' '}
            {profile.authProvider === 'local' ? 'ローカル認証（開発用）' : 'Supabase Auth'}
          </p>
          <div className="form-grid">
            <label>
              呼ばれたい名前
              <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              表示タイムゾーン
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {[
                  'Asia/Tokyo',
                  'UTC',
                  'America/Los_Angeles',
                  'America/New_York',
                  'Europe/London',
                  'Europe/Paris',
                  'Asia/Singapore',
                  'Australia/Sydney',
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="small muted">
            記録日時は UTC
            で保存し、このタイムゾーンで表示します。出来事の日付は暦日として保持します。
          </p>
          <div className="section-heading">
            <h3>表示テーマ</h3>
            <Button type="button" variant="secondary" onClick={() => setDark(!dark)}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}{' '}
              {dark ? 'ライトモードにする' : 'ダークモードにする'}
            </Button>
          </div>
        </div>
        <div className="panel settings-card">
          <h2>外部 AI とプライバシー</h2>
          <p>
            記録は個人的な情報を含みます。OpenAIを使う分析・対話・文字起こしは、設定での同意に加えて、送信のたびに確認します。
          </p>
          <ul className="privacy-list">
            <li>抽出：選択経路のユーザー本文と記録日時だけを分割送信。</li>
            <li>
              振り返り・対話：対象の日記・ユーザー発言、日付、確認済み感情・身体感覚等を最大12件まで送信。過去の類似記録を含む場合があります。
            </li>
            <li>音声：文字起こしボタンを押した時に、その音声を送信。</li>
            <li>AIの解釈は推測です。心理的診断は行いません。</li>
            <li>
              送信済みデータはこのアプリから取り消せません。API事業者の保存期間は契約・設定に依存します。
            </li>
          </ul>
          <a
            href="https://openai.com/policies/privacy-policy/"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            OpenAI のプライバシーポリシー ↗
          </a>
          <label className="check consent-setting">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            上記を理解し、明示的に選択した処理でのみ外部 AI を利用することに同意します
          </label>
          <p className="small muted">
            接続状態：
            {profile.aiAvailable ? 'OpenAI設定済み' : 'OpenAI未設定（外部送信なしで利用可能）'} ·
            モデル：{profile.model}
          </p>
          <Button disabled={busy} type="submit">
            {busy ? '保存中…' : '設定を保存'}
          </Button>
          {message && (
            <p role="status" className="success">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      </form>
      <div className="panel settings-card">
        <h2>あなたのデータ</h2>
        <p className="small muted">
          原文と日記の本文はサーバー側で暗号化して保存します。書き出した JSON
          は平文です。安全な場所で管理してください。
        </p>
        <div className="settings-actions">
          <a className="btn btn-secondary" href="/api/data/export" download>
            <Download size={16} />
            すべてのデータを書き出す
          </a>
          <Button variant="secondary" onClick={onDelete}>
            <Trash2 size={16} />
            すべての記録を削除する
          </Button>
          <Button variant="danger" onClick={onAccount}>
            アカウントを完全削除する
          </Button>
          <Button variant="ghost" onClick={onLogout}>
            <LogOut size={16} />
            ログアウト
          </Button>
        </div>
        <p className="small muted">
          稼働中DBから削除します。運用者が保管する暗号化バックアップには、設定された保管期限まで残る場合があります。インポート単位の削除は履歴画面から行えます。
        </p>
      </div>
    </>
  );
}
