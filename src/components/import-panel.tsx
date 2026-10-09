'use client';
import { useState, useRef } from 'react';
import {
  Upload,
  FileArchive,
  ArrowRight,
  Check,
  Pause,
  Play,
  Trash2,
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-react';
import { api, send } from '@/lib/client';
import { emotionNames, type ImportPreview, type Candidate, type Source } from '@/lib/types';
import { Button } from './ui/button';
import { AiControl, Empty, formatTime } from './shared';
export function ImportPanel({
  jobs,
  candidates,
  profile,
  onRefresh,
  onReview,
  onSource,
  onDelete,
}: {
  jobs: any[];
  candidates: Candidate[];
  profile: any;
  onRefresh: () => Promise<void>;
  onReview: (c: Candidate) => void;
  onSource: (s: Source) => void;
  onDelete: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [method, setMethod] = useState<'local' | 'openai'>('local'),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [tab, setTab] = useState<'upload' | 'review' | 'history'>('upload');
  const fileRef = useRef<HTMLInputElement>(null);
  async function choose(f: File) {
    setError('');
    setPreview(null);
    setConfirmed(false);
    setFile(f);
    if (f.size > profile.uploadLimitMb * 1024 * 1024) {
      setError(`アップロード上限は${profile.uploadLimitMb} MBです`);
      return;
    }
    setBusy(true);
    try {
      const d = new FormData();
      d.append('file', f);
      const p = await api<ImportPreview>('imports/preview', { method: 'POST', body: d });
      setPreview(p);
      setSelected(p.conversations.map((c) => c.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const d = new FormData();
      d.append('file', file);
      d.append('selected', JSON.stringify(selected));
      d.append('method', method);
      d.append('confirmed', String(confirmed));
      d.append('aiConsent', String(consent));
      await api('imports', { method: 'POST', body: d });
      setPreview(null);
      setFile(null);
      setTab('history');
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function control(id: string, action: string) {
    setError('');
    try {
      await send('imports/' + id, { action });
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reject(c: Candidate) {
    setError('');
    try {
      await send('candidates/' + c.id, { action: 'reject' });
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const pending = candidates.filter((c) => c.status === 'pending');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORDS, CONNECTED</span>
          <h1>過去の言葉を、今につなぐ。</h1>
          <p>ChatGPTで積み重ねた自己理解も、あなたの大切な記録です。</p>
        </div>
        <FileArchive className="heading-icon" size={34} />
      </div>
      <div className="tabs" role="tablist" aria-label="インポート画面">
        {[
          ['upload', 'アップロード'],
          ['review', `確認・修正 ${pending.length ? `(${pending.length})` : ''}`],
          ['history', 'インポート履歴'],
        ].map(([k, label]) => (
          <button
            role="tab"
            aria-selected={tab === k}
            key={k}
            onClick={() => setTab(k as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {tab === 'upload' && (
        <>
          {!preview ? (
            <div
              className="upload-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) void choose(f);
              }}
            >
              <div className="upload-icon">
                <Upload size={28} />
              </div>
              <h2>これまでの会話を、お迎えしましょう。</h2>
              <p>
                公式データエクスポートの ZIP または conversations.json
                <br />
                最大 {profile.uploadLimitMb} MB。原文はそのまま保存されます。
              </p>
              <Button disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? '構造を検証しています…' : 'ファイルを選ぶ'}
                <ArrowRight size={16} />
              </Button>
              <input
                ref={fileRef}
                aria-label="ChatGPTエクスポートを選択"
                type="file"
                accept=".zip,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void choose(f);
                  e.target.value = '';
                }}
              />
              <span className="small muted">またはファイルをここにドロップ</span>
            </div>
          ) : (
            <div className="panel preview-panel">
              <div className="section-heading">
                <h2>保存前のプレビュー</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPreview(null);
                    setFile(null);
                  }}
                >
                  選び直す
                </Button>
              </div>
              <div className="preview-stats">
                <div>
                  <strong>{preview.count.toLocaleString()}</strong>
                  <span>会話</span>
                </div>
                <div>
                  <strong>{preview.messages.toLocaleString()}</strong>
                  <span>メッセージ</span>
                </div>
                <div>
                  <strong>約{Math.ceil(preview.estimateSeconds / 60)}分</strong>
                  <span>AI処理の目安</span>
                </div>
              </div>
              <p className="small">
                対象期間（記録日時）：{formatTime(preview.period.from, profile.timezone, true)} 〜{' '}
                {formatTime(preview.period.to, profile.timezone, true)}
              </p>
              <p className="small muted">
                最大推定 {preview.estimatedTokens.toLocaleString()} tokens / $
                {preview.estimatedCost.toFixed(4)}
                。選択件数やAPI応答により変わります。外部送信なしの処理は無料です。
              </p>
              <div className="section-heading">
                <h3>取り込む会話を選択</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelected(
                      selected.length === preview.count
                        ? []
                        : preview.conversations.map((c) => c.id),
                    )
                  }
                >
                  {selected.length === preview.count ? 'すべて外す' : 'すべて選択'}
                </Button>
              </div>
              <div className="conversation-select">
                {preview.conversations.map((c) => (
                  <label key={c.id} className="check conversation-check">
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={(e) =>
                        setSelected((v) =>
                          e.target.checked ? [...v, c.id] : v.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <span>
                      <strong>{c.title}</strong>
                      <small>
                        {formatTime(c.created_at, profile.timezone, true)} · {c.messages}メッセージ
                        · 選択経路のユーザー発言 {c.users}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {preview.warnings.map((w, i) => (
                <p className="notice" key={i}>
                  {w}
                </p>
              ))}
              <AiControl
                method={method}
                setMethod={setMethod}
                consent={consent}
                setConsent={setConsent}
                available={profile.aiAvailable}
                allowed={profile.ai_consent}
                scope={preview.transmission}
              />
              <label className="check confirm-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                選択した{selected.length}件の会話原文を保存し、ジャーナル候補の抽出を開始します
              </label>
              <Button
                disabled={
                  !confirmed || !selected.length || busy || (method === 'openai' && !consent)
                }
                onClick={commit}
              >
                {busy ? '保存中…' : '確認してインポートを開始'}
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          <div className="import-guide">
            <div>
              <ShieldCheck size={22} />
              <h3>あなたの言葉を、丁寧に。</h3>
              <p>
                AIの発言とあなたの発言を分け、原文・抽出候補・確認した日記を別々に保存します。候補は確認するまでグラフに反映されません。
              </p>
            </div>
            <div>
              <h3>エクスポートの取得方法</h3>
              <p>
                ChatGPT の「設定 → データコントロール →
                データをエクスポート」から取得してください。アカウントへの直接接続は行いません。
              </p>
            </div>
          </div>
        </>
      )}
      {tab === 'review' && (
        <>
          <div className="notice">
            推測された感情の強さ・出来事の日付を、自分の感覚に合わせて確かめてください。日付不明の候補を無理に日付へ当てはめる必要はありません。
          </div>
          {!candidates.length ? (
            <Empty title="確認する候補はまだありません">
              会話をインポートすると、ここに抽出された記録が届きます。
            </Empty>
          ) : (
            <div className="candidate-list">
              {candidates.map((c) => (
                <article
                  className={'panel candidate ' + (c.status !== 'pending' ? 'reviewed' : '')}
                  key={c.id}
                >
                  <div className="row between">
                    <span className="small muted">
                      出来事：{formatTime(c.event_date, profile.timezone, true)}{' '}
                      {c.date_kind === 'estimated' && <span className="badge">推定日付</span>}
                    </span>
                    <span className="badge">
                      {c.status === 'confirmed'
                        ? '確認済み'
                        : c.status === 'rejected'
                          ? '除外済み'
                          : '未確認'}
                    </span>
                  </div>
                  <h3>{c.conversation_title}</h3>
                  <p className="pre">
                    {c.text.slice(0, 350)}
                    {c.text.length > 350 ? '…' : ''}
                  </p>
                  <div className="emotion-tags">
                    {Object.entries(c.emotions).map(([k, v]) => (
                      <span key={k}>
                        {emotionNames[k as keyof typeof emotionNames]} {v}
                      </span>
                    ))}
                  </div>
                  <p className="small muted">
                    記録：{formatTime(c.recorded_at, profile.timezone, true)} ·{' '}
                    {c.method === 'local' ? 'キーワード候補' : 'AIの推測'} · 信頼度{' '}
                    {Math.round(c.confidence * 100)}%
                  </p>
                  <div className="row wrap">
                    <Button size="sm" onClick={() => onReview(c)}>
                      <Check size={14} />
                      {c.status === 'confirmed' ? '修正する' : '確認・修正する'}
                    </Button>
                    {c.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => reject(c)}>
                        候補を除外
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onSource({
                          id: c.source_message_id,
                          date: c.recorded_at,
                          label: c.conversation_title,
                          text: c.text,
                          type: 'message',
                        })
                      }
                    >
                      原文を見る
                      <ArrowUpRight size={14} />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {tab === 'history' && (
        <>
          {!jobs.length ? (
            <Empty title="インポート履歴はまだありません">
              同じファイルを再度取り込んでも、会話とメッセージIDで重複を防ぎます。
            </Empty>
          ) : (
            jobs.map((j) => (
              <article key={j.id} className="panel job-card">
                <div className="section-heading">
                  <div>
                    <h3>
                      {
                        (
                          {
                            queued: j.stage === 'ingest' ? '原文を保存中' : '抽出待ち',
                            running: j.stage === 'ingest' ? '原文を保存中' : '抽出中',
                            paused: '一時停止',
                            completed: '完了',
                            failed: '要再試行',
                          } as Record<string, string>
                        )[j.status]
                      }
                    </h3>
                    <span className="small muted">
                      {formatTime(j.created_at, profile.timezone, true)} ·{' '}
                      {j.method === 'local' ? '外部送信なし' : 'OpenAI'}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="インポートを削除"
                    onClick={() => onDelete(j.id)}
                  >
                    <Trash2 size={17} />
                  </Button>
                </div>
                <progress
                  value={j.stage === 'ingest' ? j.ingest_cursor : j.processed}
                  max={Math.max(j.stage === 'ingest' ? j.ingest_total : j.total, 1)}
                  aria-label="インポートの進捗"
                />
                <p className="small">
                  {j.stage === 'ingest'
                    ? `${j.ingest_cursor} / ${j.ingest_total} メッセージを保存`
                    : `${j.processed} / ${j.total} 分割を抽出`}{' '}
                  · 新規 {j.added}件・重複 {j.duplicates}件 ·{' '}
                  {(j.input_tokens + j.output_tokens).toLocaleString()} tokens · $
                  {Number(j.cost_usd).toFixed(4)}
                </p>
                {j.error && <p className="error">{j.error}</p>}
                {j.warnings?.map((w: string, i: number) => (
                  <p key={i} className="small muted">
                    {w}
                  </p>
                ))}
                <div className="row wrap">
                  {['queued', 'running'].includes(j.status) && (
                    <Button size="sm" variant="secondary" onClick={() => control(j.id, 'pause')}>
                      <Pause size={14} />
                      中断する
                    </Button>
                  )}
                  {['paused', 'failed'].includes(j.status) && (
                    <Button size="sm" variant="secondary" onClick={() => control(j.id, 'resume')}>
                      <Play size={14} />
                      再開・再試行
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setTab('review')}>
                    候補を確認する
                    <ArrowRight size={14} />
                  </Button>
                </div>
              </article>
            ))
          )}
          <p className="small muted">
            表示費用は概算で、取得できたAPI使用量に基づきます。通信断時はAPIの請求明細も確認してください。この画面を閉じても、次回開いたときに保存済みの進捗から再開します。バックグラウンドワーカー設定時は画面を閉じても処理が進みます。
          </p>
        </>
      )}
    </>
  );
}
