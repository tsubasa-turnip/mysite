'use client';
import { ArrowUpRight, LockKeyhole, CloudSun, BookOpen } from 'lucide-react';
import type { Source } from '@/lib/types';
import { zonedDay } from '@/lib/dates';
export function zonedToday(timezone: string) {
  return zonedDay(new Date().toISOString(), timezone);
}
export function emptyJournal(timezone: string) {
  return {
    text: '',
    emotions: {},
    energy: null,
    stress: null,
    mood: null,
    body: '',
    events: '',
    insights: '',
    values: [],
    trigger: '',
    success: '',
    conflict: '',
    recovery: '',
    important: '',
    event_date: zonedToday(timezone),
    date_kind: 'explicit',
    recorded_at: new Date().toISOString(),
    anchor: false,
  };
}
export function formatTime(v: string | null, timezone = 'Asia/Tokyo', long = false) {
  if (!v) return '日付不明';
  if (v.length === 10)
    return new Intl.DateTimeFormat('ja-JP', {
      year: long ? 'numeric' : undefined,
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(v + 'T00:00:00Z'));
  return new Intl.DateTimeFormat('ja-JP', {
    year: long ? 'numeric' : undefined,
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(v));
}
export function Sources({
  sources,
  onOpen,
  timezone,
}: {
  sources: Source[];
  onOpen: (s: Source) => void;
  timezone: string;
}) {
  return (
    <div className="source-list">
      {sources.map((s) => (
        <a
          key={s.id}
          className="source-card"
          href={`#source/${s.type}/${s.id}`}
          onClick={(e) => {
            e.preventDefault();
            onOpen(s);
          }}
        >
          <span>
            <BookOpen size={14} />
            {s.type === 'message' ? '会話の原文' : '日記'} · {formatTime(s.date, timezone, true)}
            {s.context?.date_kind === 'estimated' ? ' · 推定日付' : ''}
          </span>
          <strong>{s.label}</strong>
          <p>{s.text.slice(0, 100)}</p>
          <ArrowUpRight size={17} />
        </a>
      ))}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <CloudSun size={36} strokeWidth={1.2} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function AiControl({
  method,
  setMethod,
  consent,
  setConsent,
  available,
  allowed,
  scope,
}: {
  method: 'local' | 'openai';
  setMethod: (v: 'local' | 'openai') => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  available: boolean;
  allowed: boolean;
  scope: string;
}) {
  return (
    <div className="ai-control">
      <div className="row wrap">
        <LockKeyhole size={16} />
        <label>
          処理方法
          <select
            aria-label="処理方法"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as 'local' | 'openai');
              setConsent(false);
            }}
          >
            <option value="local">外部送信なし・原文を整理</option>
            <option value="openai" disabled={!available || !allowed}>
              OpenAI で分析{!available ? '（未設定）' : !allowed ? '（設定で同意が必要）' : ''}
            </option>
          </select>
        </label>
      </div>
      {method === 'openai' ? (
        <>
          <p className="small muted">
            {scope} API利用料が発生します。送信済みの情報はアプリから取り消せません。
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            この範囲のデータを OpenAI へ送信することに同意します
          </label>
        </>
      ) : (
        <p className="small muted">
          この処理で記録を外部に送りません。AIによる推測は心理的診断ではありません。
        </p>
      )}
    </div>
  );
}
