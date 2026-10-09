'use client';
import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Sparkles, ArrowRight } from 'lucide-react';
import { chartSeries } from '@/lib/dates';
import { emotionNames, type Entry, type Source } from '@/lib/types';
import { send } from '@/lib/client';
import { Button } from './ui/button';
import { AiControl, Empty, Sources, formatTime, zonedToday } from './shared';
const colors: Record<string, string> = {
  joy: '#d49b59',
  calm: '#6d9584',
  anxiety: '#b899b6',
  sadness: '#8dabc7',
  anger: '#c88270',
  gratitude: '#aaa86b',
  hope: '#d7af69',
  loneliness: '#9e93b3',
  energy: '#d49b59',
  stress: '#b899b6',
  mood: '#6d9584',
};
export function getRange(period: string, date: string) {
  const end = new Date(date + 'T00:00:00Z'),
    start = new Date(end);
  if (period === 'week') start.setUTCDate(end.getUTCDate() - 6);
  else if (period === 'month') start.setUTCDate(1);
  else {
    start.setUTCMonth(0, 1);
  }
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
export function InsightsPanel({
  entries,
  insights,
  profile,
  onRefresh,
  onSource,
  onEntry,
}: {
  entries: Entry[];
  insights: any[];
  profile: any;
  onRefresh: () => Promise<void>;
  onSource: (s: Source) => void;
  onEntry: (e: Entry) => void;
}) {
  const [period, setPeriod] = useState('month'),
    [date, setDate] = useState(zonedToday(profile.timezone)),
    [mode, setMode] = useState<'emotions' | 'metrics'>('emotions'),
    [visible, setVisible] = useState(['joy', 'calm', 'anxiety']),
    [day, setDay] = useState<string | null>(null),
    [method, setMethod] = useState<'local' | 'openai'>('local'),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const range = getRange(period, date);
  const data = useMemo(
    () => chartSeries(entries, range.from, range.to),
    [entries, range.from, range.to],
  );
  const recorded = entries.filter(
    (e) => e.event_date && e.event_date >= range.from && e.event_date <= range.to,
  );
  const keys = mode === 'metrics' ? ['energy', 'stress', 'mood'] : visible;
  const events = recorded.filter((e) => !day || e.event_date === day);
  async function review(p: 'week' | 'month') {
    setBusy(true);
    setError('');
    try {
      await send('insights', { period: p, ...getRange(p, date), method, consent });
      await onRefresh();
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
          <span className="eyebrow">PATTERNS, WITHOUT JUDGMENT</span>
          <h1>心の移ろいを、眺める。</h1>
          <p>良い日も、揺れる日も。どれも、あなたを知る手がかり。</p>
        </div>
        <Sparkles size={30} className="heading-icon" />
      </div>
      <div className="panel graph-panel">
        <div className="section-heading">
          <h2>感情の天気図</h2>
          <div className="row wrap">
            <div className="segmented">
              {[
                ['week', '週間'],
                ['month', '月間'],
                ['year', '年間'],
              ].map(([k, l]) => (
                <button
                  key={k}
                  aria-pressed={period === k}
                  onClick={() => {
                    setPeriod(k);
                    setDay(null);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            <input
              aria-label="表示期間の最終日"
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
                setDay(null);
              }}
            />
          </div>
        </div>
        <div className="row between wrap">
          <span className="small muted">
            {range.from} — {range.to} · 確認済みの日記 {recorded.length}件
          </span>
          <div className="segmented">
            <button aria-pressed={mode === 'emotions'} onClick={() => setMode('emotions')}>
              感情
            </button>
            <button aria-pressed={mode === 'metrics'} onClick={() => setMode('metrics')}>
              エネルギー・ストレス・気分
            </button>
          </div>
        </div>
        <div className="chart" aria-label="感情の時系列グラフ">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              onClick={(state) => {
                const label = state?.activeLabel;
                if (typeof label === 'string') setDay(label);
              }}
              margin={{ top: 18, right: 15, bottom: 8, left: -20 }}
            >
              <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5).replace('-', '/')}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                minTickGap={30}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 10]}
                ticks={[0, 5, 10]}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelFormatter={(label) => String(label)}
                formatter={(v, name) => [
                  v === null ? '未記録' : v,
                  emotionNames[name as keyof typeof emotionNames] ||
                    (
                      { energy: '心のエネルギー', stress: 'ストレス', mood: '気分' } as Record<
                        string,
                        string
                      >
                    )[String(name)],
                ]}
              />
              {keys.map((k) => (
                <Line
                  key={k}
                  dataKey={k}
                  name={k}
                  stroke={colors[k]}
                  strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {mode === 'emotions' && (
          <div className="chart-legend">
            {Object.entries(emotionNames).map(([k, label]) => (
              <button
                key={k}
                aria-pressed={visible.includes(k)}
                onClick={() =>
                  setVisible((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))
                }
              >
                <i style={{ background: visible.includes(k) ? colors[k] : 'var(--border)' }} />
                {label}
              </button>
            ))}
          </div>
        )}
        <p className="small muted">
          未記録は空白、0は記録値です。同日の複数記録は平均を表示します。点を選ぶと、その日の記録を確認できます。推定日付も含みます。
        </p>
        {!recorded.length && (
          <p className="notice">
            この期間の記録はありません。日記を残すか、インポートした候補を確認してください。
          </p>
        )}
      </div>
      <div className="section-heading">
        <h2>{day ? `${day} の出来事` : 'この期間の出来事'}</h2>
        {day && (
          <Button variant="ghost" size="sm" onClick={() => setDay(null)}>
            すべて表示
          </Button>
        )}
      </div>
      <div className="event-list">
        {events.map((e) => (
          <button className="event-row" key={e.id} onClick={() => onEntry(e)}>
            <span className="event-dot" />
            <span>
              <small>
                {formatTime(e.event_date, profile.timezone)}
                {e.date_kind === 'estimated' ? ' · 推定日付' : ''}
              </small>
              <strong>{e.events || e.text.slice(0, 65)}</strong>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
        {!events.length && <p className="small muted">この日付の記録はありません。</p>}
      </div>
      <p className="small muted">
        日付不明の記録 {entries.filter((e) => !e.event_date).length}
        件はグラフに含めていません。日記画面から確認できます。
      </p>
      <div className="panel reflection-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">A GENTLE REFLECTION</span>
            <h2>自分を知る、小さな振り返り。</h2>
          </div>
          <Sparkles size={22} />
        </div>
        <AiControl
          method={method}
          setMethod={setMethod}
          consent={consent}
          setConsent={setConsent}
          available={profile.aiAvailable}
          allowed={profile.ai_consent}
          scope="選択期間の日記と過去の類似記録を合計最大12件、各本文3,000文字・日付・確認済み項目1,000文字までを送信します。"
        />
        <div className="row wrap">
          <Button
            disabled={busy || (method === 'openai' && !consent)}
            onClick={() => review('week')}
          >
            {busy ? '振り返り中…' : '週次の振り返り'}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || (method === 'openai' && !consent)}
            onClick={() => review('month')}
          >
            月次の振り返り
          </Button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!insights.length ? (
        <Empty title="振り返りは、これから">
          記録がたまったら、少し立ち止まって眺めてみましょう。
        </Empty>
      ) : (
        insights.map((i) => (
          <article className="panel insight-card" key={i.id}>
            <div className="row between">
              <span className="eyebrow">
                {i.period === 'week' ? 'WEEKLY' : 'MONTHLY'} REFLECTION
              </span>
              <span className="badge">{i.method === 'local' ? '原文による整理' : 'AIの推測'}</span>
            </div>
            <h3>
              {i.from} — {i.to}
            </h3>
            <p className="pre">{i.answer}</p>
            <p className="small muted">
              心理的診断ではありません。分析は一つの見方です。{i.limitedTo}件を参照 · $
              {(i.usage?.cost || 0).toFixed(4)}
            </p>
            <Sources sources={i.sources || []} onOpen={onSource} timezone={profile.timezone} />
            {i.similar?.length > 0 && (
              <>
                <h4>過去の似た記録</h4>
                <Sources sources={i.similar} onOpen={onSource} timezone={profile.timezone} />
              </>
            )}
          </article>
        ))
      )}
    </>
  );
}
