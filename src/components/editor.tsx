'use client';
import { useState } from 'react';
import { Bookmark, ChevronDown } from 'lucide-react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Voice } from './voice';
import { emotionNames, type Entry, type Candidate } from '@/lib/types';
import { emptyJournal, zonedToday } from './shared';
export function Editor({
  entry,
  candidate,
  initialEmotion,
  timezone,
  aiAvailable,
  aiConsent,
  uploadLimitMb,
  onClose,
  onSave,
}: {
  entry?: Entry;
  candidate?: Candidate;
  initialEmotion?: string;
  timezone: string;
  aiAvailable: boolean;
  aiConsent: boolean;
  uploadLimitMb: number;
  onClose: () => void;
  onSave: (value: unknown) => Promise<void>;
}) {
  const initial = entry || candidate;
  const [form, setForm] = useState<any>(() =>
      initial
        ? {
            ...emptyJournal(timezone),
            ...initial,
            recorded_at: initial.recorded_at || new Date().toISOString(),
            anchor: entry?.anchor ?? false,
          }
        : { ...emptyJournal(timezone), emotions: initialEmotion ? { [initialEmotion]: 5 } : {} },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function update(key: string, value: unknown) {
    setForm((v: any) => ({ ...v, [key]: value }));
  }
  const recordedDate = new Date(form.recorded_at);
  const localParts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(recordedDate);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できません');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title={candidate ? '抽出された記録を確認' : entry ? '日記を編集' : '今の心を、書きとめる'}
      description={
        candidate
          ? '原文は変更されません。日付と感情を確認して、日記に保存するとグラフへ反映されます。'
          : 'まとまっていなくても大丈夫。今、感じていることから。'
      }
    >
      <form onSubmit={submit} className="editor-form">
        <label>
          日記
          <textarea
            aria-label="日記"
            autoFocus
            rows={7}
            maxLength={30000}
            required
            placeholder="今日、心に残ったことは？"
            value={form.text}
            onChange={(e) => update('text', e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            出来事の日付
            <input
              type="date"
              value={form.event_date || ''}
              onChange={(e) => {
                update('event_date', e.target.value || null);
                update('date_kind', e.target.value ? 'explicit' : 'unknown');
              }}
            />
          </label>
          <label>
            日付の確かさ
            <select
              value={form.date_kind}
              onChange={(e) => {
                update('date_kind', e.target.value);
                if (e.target.value === 'unknown') update('event_date', null);
                else if (!form.event_date) update('event_date', zonedToday(timezone));
              }}
            >
              <option value="explicit">確認した日付</option>
              <option value="estimated">推定日付</option>
              <option value="unknown">日付不明</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          記録日時：{localParts} ({timezone})。出来事の日付とは別に保存します。
        </p>
        <details>
          <summary>
            記録日時を調整する <ChevronDown size={14} />
          </summary>
          <label>
            記録日時（UTC）
            <input
              type="datetime-local"
              value={form.recorded_at?.slice(0, 16) || ''}
              onChange={(e) => {
                if (e.target.value)
                  update('recorded_at', new Date(e.target.value + 'Z').toISOString());
              }}
            />
          </label>
        </details>
        <fieldset>
          <legend>
            今、ある感情 <span className="muted small">複数選択できます</span>
          </legend>
          <div className="emotion-picker">
            {Object.entries(emotionNames).map(([k, label]) => {
              const selected = typeof form.emotions[k] === 'number';
              return (
                <div key={k} className={'emotion-option ' + (selected ? 'selected' : '')}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const emotions = { ...form.emotions };
                        if (e.target.checked) emotions[k] = 5;
                        else delete emotions[k];
                        update('emotions', emotions);
                      }}
                    />
                    {label}
                  </label>
                  {selected && (
                    <label className="slider-label">
                      <span>
                        強さ <b>{form.emotions[k]}</b>
                      </span>
                      <input
                        aria-label={`${label}の強さ`}
                        type="range"
                        min="0"
                        max="10"
                        step="1"
                        value={form.emotions[k]}
                        onChange={(e) =>
                          update('emotions', { ...form.emotions, [k]: +e.target.value })
                        }
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <p className="small muted">
            選択しない感情は未記録です。強さ 0 は記録値として保存します。
          </p>
        </fieldset>
        <div className="metric-edit">
          {[
            ['energy', '心のエネルギー'],
            ['stress', 'ストレス'],
            ['mood', '気分'],
          ].map(([k, label]) => (
            <div key={k}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form[k] !== null}
                  onChange={(e) => update(k, e.target.checked ? 5 : null)}
                />
                {label}
              </label>
              {form[k] !== null ? (
                <label className="slider-label">
                  <span>{form[k]} / 10</span>
                  <input
                    aria-label={label}
                    type="range"
                    min="0"
                    max="10"
                    value={form[k]}
                    onChange={(e) => update(k, +e.target.value)}
                  />
                </label>
              ) : (
                <span className="small muted">未記録</span>
              )}
            </div>
          ))}
        </div>
        <details>
          <summary>
            身体・出来事・気づきも残す <ChevronDown size={14} />
          </summary>
          <div className="detail-fields">
            {[
              ['body', '身体感覚'],
              ['events', '出来事'],
              ['trigger', '感情が動いたきっかけ'],
              ['insights', '気づき・自己理解'],
              ['success', '達成感・成功体験'],
              ['conflict', '不安・葛藤'],
              ['recovery', '回復のきっかけ'],
              ['important', '大切な瞬間'],
            ].map(([k, label]) => (
              <label key={k}>
                {label}
                <textarea
                  rows={2}
                  maxLength={3000}
                  value={form[k]}
                  onChange={(e) => update(k, e.target.value)}
                />
              </label>
            ))}
            <label>
              大切にしたい価値観（読点区切り）
              <input
                value={form.values.join('、')}
                onChange={(e) => update('values', e.target.value.split(/[、,]/).filter(Boolean))}
              />
            </label>
          </div>
        </details>
        <label className="check anchor-check">
          <input
            type="checkbox"
            checked={form.anchor}
            onChange={(e) => update('anchor', e.target.checked)}
          />
          <Bookmark size={17} />
          アンカーとして、大切な瞬間を残す
        </label>
        {!candidate && (
          <Voice
            uploadLimitMb={uploadLimitMb}
            aiAvailable={aiAvailable}
            aiConsent={aiConsent}
            onText={(v) => update('text', form.text + (form.text ? '\n' : '') + v)}
          />
        )}{' '}
        {candidate && (
          <div className="notice">
            {candidate.method === 'local' ? 'キーワードによる候補' : 'AIによる推測'} · 信頼度{' '}
            {Math.round(candidate.confidence * 100)}
            %。感情の強さは推測です。自分の感覚に合わせて修正してください。
            <details>
              <summary>抽出の根拠</summary>
              <p className="pre">{candidate.evidence}</p>
            </details>
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            キャンセル
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? '保存中…' : candidate ? '確認して日記に保存' : '日記を保存'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
