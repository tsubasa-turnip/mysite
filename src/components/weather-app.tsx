'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Home,
  BookOpen,
  ChartNoAxesCombined,
  MessagesSquare,
  Upload,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Sun,
  Cloud,
  CloudSun,
  Wind,
  Bookmark,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Check,
  Trash2,
  Pencil,
  Moon,
} from 'lucide-react';
import { api, send } from '@/lib/client';
import { emotionNames, type Entry, type Candidate, type Source } from '@/lib/types';
import { Editor } from './editor';
import { ImportPanel } from './import-panel';
import { InsightsPanel } from './insights-panel';
import { ReflectPanel } from './reflect-panel';
import { SettingsPanel } from './settings-panel';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Empty, formatTime, zonedToday } from './shared';
type View = 'home' | 'journal' | 'insights' | 'reflect' | 'import' | 'settings';
const nav = [
  { id: 'home', label: 'ホーム', english: 'Home', icon: Home },
  { id: 'journal', label: '記録', english: 'Journal', icon: BookOpen },
  { id: 'insights', label: '心の天気図', english: 'Insights', icon: ChartNoAxesCombined },
  { id: 'reflect', label: '振り返る', english: 'Reflect', icon: MessagesSquare },
  { id: 'import', label: 'インポート', english: 'Import', icon: Upload },
  { id: 'settings', label: '設定', english: 'Settings', icon: Settings },
] as const;
export function WeatherApp() {
  const [user, setUser] = useState<any>(null),
    [profile, setProfile] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [view, setView] = useState<View>('home'),
    [entries, setEntries] = useState<Entry[]>([]),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [conversations, setConversations] = useState<any[]>([]),
    [insights, setInsights] = useState<any[]>([]),
    [chats, setChats] = useState<any[]>([]),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [dark, setDark] = useState(false),
    [editor, setEditor] = useState<{
      entry?: Entry;
      candidate?: Candidate;
      emotion?: string;
    } | null>(null),
    [source, setSource] = useState<any>(null),
    [selectedOnly, setSelectedOnly] = useState(true),
    [targetMessage, setTargetMessage] = useState(''),
    [confirm, setConfirm] = useState<{
      title: string;
      text: string;
      action: () => Promise<void>;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [journalTab, setJournalTab] = useState('notes'),
    [search, setSearch] = useState(''),
    [searchDay, setSearchDay] = useState(''),
    [searchResults, setSearchResults] = useState<Source[]>([]);
  const load = useCallback(async () => {
    const [m, e, c, j, v, i, h] = await Promise.all([
      api('me'),
      api('journals'),
      api('candidates'),
      api('imports'),
      api('conversations'),
      api('insights'),
      api('reflect'),
    ]);
    setUser(m.user);
    setProfile(m.profile);
    setEntries(e);
    setCandidates(c);
    setJobs(j);
    setConversations(v);
    setInsights(i);
    setChats(h);
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem('iw-theme');
    setDark(saved === 'dark');
    api('me')
      .then(async (m) => {
        setUser(m.user);
        setProfile(m.profile);
        await load();
      })
      .catch((e) => {
        if (!/ログイン|セッション|再度/.test(e.message)) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('iw-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  const active = jobs
    .filter((j) => ['queued', 'running'].includes(j.status))
    .map((j) => j.id)
    .sort()
    .join(',');
  useEffect(() => {
    if (!user || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const id = active.split(',')[0];
        await send('imports/' + id + '/step', {});
        if (stopped) return;
        const [j, c] = await Promise.all([api('imports'), api('candidates')]);
        if (!stopped) {
          setJobs(j);
          setCandidates(c);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(tick, 3500);
    }
    timer = setTimeout(tick, 800);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, user?.id]);
  async function openSource(s: Source) {
    setError('');
    try {
      if (s.type === 'journal') {
        const entry = entries.find((e) => e.id === s.id);
        if (!entry) throw new Error('日記が見つかりません');
        setSource({ kind: 'journal', entry });
      } else {
        const data = await api('messages/' + s.id);
        setTargetMessage(s.id);
        setSelectedOnly(data.messages.find((m: any) => m.id === s.id)?.on_path !== false);
        setSource({ kind: 'conversation', ...data });
      }
      window.history.replaceState(null, '', `#source/${s.type}/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!user || loading) return;
    const match = window.location.hash.match(/^#source\/(journal|message)\/([a-f\d-]+)$/);
    if (match)
      void openSource({
        type: match[1] as Source['type'],
        id: match[2],
        date: null,
        label: '原文',
        text: '',
      });
  }, [user?.id, loading]);
  useEffect(() => {
    if (source && targetMessage)
      setTimeout(
        () =>
          document.getElementById('message-' + targetMessage)?.scrollIntoView({ block: 'center' }),
        150,
      );
  }, [source, targetMessage]);
  function closeSource() {
    setSource(null);
    setTargetMessage('');
    window.history.replaceState(null, '', window.location.pathname);
  }
  async function save(value: unknown) {
    if (editor?.candidate)
      await send('candidates/' + editor.candidate.id, { action: 'confirm', entry: value });
    else
      await send(
        'journals' + (editor?.entry ? '/' + editor.entry.id : ''),
        value,
        editor?.entry ? 'PATCH' : 'POST',
      );
    await load();
    setToast('あなたの記録を保存しました');
  }
  function removeEntry(e: Entry) {
    setConfirm({
      title: 'この日記を削除しますか？',
      text: '日記・感情スコア・アンカーを削除します。インポートした会話の原文は保持されます。',
      action: async () => {
        await api('journals/' + e.id, { method: 'DELETE' });
        closeSource();
        await load();
        setToast('日記を削除しました');
      },
    });
  }
  async function toggleAnchor(e: Entry) {
    try {
      await send('journals/' + e.id, { ...e, anchor: !e.anchor }, 'PATCH');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function logout() {
    await send('auth/logout', {});
    setUser(null);
    setProfile(null);
    setEntries([]);
    setJobs([]);
    setCandidates([]);
    setChats([]);
    setSource(null);
  }
  function changeView(next: View) {
    setView(next);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Wind size={40} strokeWidth={1} />
        <p>心の余白を、準備しています。</p>
      </div>
    );
  if (!user)
    return (
      <Auth
        onReady={async () => {
          await load();
          setError('');
        }}
        error={error}
      />
    );
  const timezone = profile.timezone,
    today = zonedToday(timezone),
    todayEntries = entries.filter((e) => e.event_date === today),
    latest = todayEntries[0],
    pending = candidates.filter((c) => c.status === 'pending').length;
  const filtered = entries.filter(
    (e) =>
      (journalTab !== 'anchors' || e.anchor) &&
      (!searchDay || e.event_date === searchDay) &&
      (!search ||
        [e.text, e.body, e.events, e.insights, ...e.values]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  function card(e: Entry) {
    return (
      <article className="journal-card" key={e.id}>
        <div className="row between">
          <button
            className="entry-date"
            onClick={() =>
              openSource({
                id: e.id,
                date: e.event_date,
                label: '日記',
                text: e.text,
                type: 'journal',
              })
            }
          >
            {formatTime(e.event_date, timezone, true)}
            {e.date_kind === 'estimated' && <span className="badge">推定</span>}
          </button>
          <button
            className={'icon-btn ' + (e.anchor ? 'anchored' : '')}
            aria-label={e.anchor ? 'アンカーを外す' : 'アンカーに保存'}
            onClick={() => toggleAnchor(e)}
          >
            <Bookmark size={18} fill={e.anchor ? 'currentColor' : 'none'} />
          </button>
        </div>
        <button
          className="entry-content"
          onClick={() =>
            openSource({
              id: e.id,
              date: e.event_date,
              label: '日記',
              text: e.text,
              type: 'journal',
            })
          }
        >
          <h3>{e.events || e.text.split('\n')[0].slice(0, 50)}</h3>
          <p>
            {e.text.slice(0, 160)}
            {e.text.length > 160 ? '…' : ''}
          </p>
        </button>
        <div className="emotion-tags">
          {Object.entries(e.emotions).map(([k, v]) => (
            <span key={k}>
              {emotionNames[k as keyof typeof emotionNames]} <b>{v}</b>
            </span>
          ))}
        </div>
        <div className="row between">
          <span className="small muted">
            {e.source_message_id ? '過去の会話から' : '日記'} · 記録{' '}
            {formatTime(e.recorded_at, timezone)}
          </span>
          <div className="row">
            <button
              className="icon-btn"
              aria-label="日記を編集"
              onClick={() => setEditor({ entry: e })}
            >
              <Pencil size={15} />
            </button>
            <button className="icon-btn" aria-label="日記を削除" onClick={() => removeEntry(e)}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </article>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            changeView('home');
          }}
        >
          <span className="brand-icon">
            <Sun size={21} strokeWidth={1.3} />
          </span>
          <span>
            inner weather<small>こころの、観測所。</small>
          </span>
        </a>
        <div className="nav-label">YOUR INNER SPACE</div>
        <nav aria-label="メインナビゲーション">
          {nav.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? 'active' : ''}
              onClick={() => changeView(n.id)}
            >
              <n.icon size={19} strokeWidth={1.6} />
              <span>{n.label}</span>
              {n.id === 'import' && pending > 0 && <small className="nav-count">{pending}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Wind size={23} strokeWidth={1.2} />
          <p>
            どんな心の天気も、
            <br />
            あっていい。
          </p>
          <span>観察して、理解して、受け入れる。</span>
        </div>
        <button className="sidebar-profile" onClick={() => changeView('settings')}>
          <span>{(profile.display_name || user.email)[0]?.toUpperCase()}</span>
          <div>
            <strong>{profile.display_name || 'あなたの空間'}</strong>
            <small>プライベートジャーナル</small>
          </div>
          <Settings size={16} />
        </button>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            YOUR SPACE <i>/</i> {nav.find((n) => n.id === view)?.english}
          </span>
          <span className="mobile-brand">inner weather</span>
          <div className="row">
            <button
              aria-label={dark ? 'ライトモード' : 'ダークモード'}
              className="icon-btn"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Button size="sm" onClick={() => setEditor({})}>
              <Plus size={16} />
              <span>記録する</span>
            </Button>
          </div>
        </header>
        <main id="main-content">
          {error && (
            <div role="alert" className="error global-error">
              {error}
              <button aria-label="エラーを閉じる" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {view === 'home' && (
            <>
              <div className="home-intro">
                <div>
                  <span className="eyebrow">
                    {formatTime(today, timezone, true).toUpperCase()}{' '}
                    <span className="eyebrow-dot" /> A MOMENT FOR YOU
                  </span>
                  <h1>
                    {profile.display_name ? `${profile.display_name}さん、` : 'おかえりなさい。'}
                    <br />
                    今日は、どんな心の天気？
                  </h1>
                  <p>少し立ち止まって、今の自分に耳をすませてみましょう。</p>
                </div>
                <div className="weather-art" aria-hidden="true">
                  <div className="sun-orb" />
                  <div className="cloud-shape cloud-one" />
                  <div className="cloud-shape cloud-two" />
                  <span className="weather-line line-one" />
                  <span className="weather-line line-two" />
                </div>
              </div>
              <div className="home-grid">
                <section className="panel mood-panel">
                  <div className="section-heading">
                    <h2>今の気持ちに、近いものは？</h2>
                    <span className="small muted">正解はありません</span>
                  </div>
                  <div className="quick-emotions">
                    {[
                      ['calm', '穏やか', CloudSun],
                      ['joy', 'うれしい', Sun],
                      ['anxiety', 'そわそわ', Wind],
                      ['sadness', '悲しい', Cloud],
                      ['hope', '前向き', CloudSun],
                    ].map(([k, label, Icon]) => {
                      const I = Icon as typeof Sun;
                      return (
                        <button
                          key={k as string}
                          onClick={() => setEditor({ emotion: k as string })}
                        >
                          <span>
                            <I size={26} strokeWidth={1.3} />
                          </span>
                          {label as string}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mood-divider" />
                  <div className="today-metrics">
                    {[
                      ['energy', '心のエネルギー'],
                      ['stress', 'ストレス'],
                      ['mood', '気分'],
                    ].map(([k, label]) => (
                      <div key={k}>
                        <span>{label}</span>
                        <strong>
                          {latest && typeof latest[k as keyof Entry] === 'number'
                            ? `${latest[k as keyof Entry]} / 10`
                            : '未記録'}
                        </strong>
                        <div className={'metric-track ' + k}>
                          <i
                            style={{
                              width:
                                latest && typeof latest[k as keyof Entry] === 'number'
                                  ? `${Number(latest[k as keyof Entry]) * 10}%`
                                  : '0%',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="small muted">
                    {latest
                      ? '今日の最新の記録です。'
                      : '今の気持ちを書きとめると、ここに届きます。'}
                  </p>
                </section>
                <section className="writing-card">
                  <span className="eyebrow">A LITTLE CHECK-IN</span>
                  <BookOpen size={25} strokeWidth={1.2} />
                  <h2>
                    言葉にすると、
                    <br />
                    見えてくること。
                  </h2>
                  <p>
                    今日、心に残った出来事は？
                    <br />
                    短い言葉でも、そのままで。
                  </p>
                  <Button variant="secondary" onClick={() => setEditor({})}>
                    日記を書いてみる
                    <ArrowUpRight size={16} />
                  </Button>
                </section>
              </div>
              {pending > 0 && (
                <button className="pending-banner" onClick={() => changeView('import')}>
                  <Check size={18} />
                  <span>
                    過去の会話から {pending}{' '}
                    件の記録候補が届いています。確認して、心の天気図につなげましょう。
                  </span>
                  <ArrowRight size={18} />
                </button>
              )}
              <div className="home-bottom">
                <section>
                  <div className="section-heading">
                    <h2>最近の記録</h2>
                    <button
                      className="text-link"
                      onClick={() => {
                        setJournalTab('notes');
                        changeView('journal');
                      }}
                    >
                      すべて見る
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {entries.length ? (
                    <div className="recent-list">{entries.slice(0, 3).map(card)}</div>
                  ) : (
                    <Empty title="最初の、ひとことから。">
                      今日の気持ちを書いても、過去の会話を迎えても。あなたのペースで始めましょう。
                    </Empty>
                  )}
                </section>
                <section>
                  <Calendar
                    entries={entries}
                    timezone={timezone}
                    onDay={(d) => {
                      setSearchDay(d);
                      setJournalTab('notes');
                      changeView('journal');
                    }}
                  />
                  <div className="anchor-promo">
                    <Bookmark size={22} strokeWidth={1.4} />
                    <h3>心のよりどころを、残す。</h3>
                    <p>
                      大切な瞬間はアンカーへ。
                      <br />
                      揺れる日に、また出会えるように。
                    </p>
                    <button
                      className="text-link"
                      onClick={() => {
                        setJournalTab('anchors');
                        setSearchDay('');
                        changeView('journal');
                      }}
                    >
                      アンカーを見る
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
              </div>
              <footer className="home-footer">
                <ShieldCheck size={14} />
                あなたの言葉は、あなたのもの。感情を評価せず、観察する場所です。
              </footer>
            </>
          )}
          {view === 'journal' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">EVERY WORD IS A PART OF YOU</span>
                  <h1>日々の言葉を、たどる。</h1>
                  <p>日記も、過去の対話も。あなたの歩みがここに。</p>
                </div>
                <Button onClick={() => setEditor({})}>
                  <Plus size={16} />
                  日記を書く
                </Button>
              </div>
              <div className="tabs" role="tablist" aria-label="記録の種類">
                {[
                  ['notes', '日記'],
                  ['conversations', '過去の会話'],
                  ['anchors', 'アンカー'],
                ].map(([k, l]) => (
                  <button
                    role="tab"
                    aria-selected={journalTab === k}
                    key={k}
                    onClick={() => {
                      setJournalTab(k);
                      setSearchResults([]);
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <form
                className="search-box"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!search.trim()) return;
                  try {
                    setSearchResults(await api('search?q=' + encodeURIComponent(search)));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Search size={18} />
                <input
                  aria-label="記録を検索"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSearchResults([]);
                  }}
                  placeholder="言葉や出来事で、記録を探す"
                />
                <Button size="sm" variant="ghost" type="submit">
                  横断検索
                </Button>
              </form>
              {searchDay && (
                <div className="row">
                  <span className="badge">{searchDay}</span>
                  <Button size="sm" variant="ghost" onClick={() => setSearchDay('')}>
                    日付の絞り込みを解除
                  </Button>
                </div>
              )}
              {searchResults.length > 0 && (
                <div className="panel">
                  <h3>横断検索の結果</h3>
                  {searchResults.map((s) => (
                    <button key={s.id} className="event-row" onClick={() => openSource(s)}>
                      <span>
                        <small>
                          {formatTime(s.date, timezone, true)} ·{' '}
                          {s.type === 'message' ? '会話' : '日記'}
                        </small>
                        <strong>{s.text.slice(0, 80)}</strong>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </div>
              )}
              {journalTab === 'conversations' ? (
                <>
                  {conversations
                    .filter((c) => !search || c.title.toLowerCase().includes(search.toLowerCase()))
                    .map((c) => (
                      <button
                        className="panel conversation-row"
                        key={c.id}
                        onClick={async () => {
                          try {
                            setSource({
                              kind: 'conversation',
                              ...(await api('conversations/' + c.id)),
                            });
                            setSelectedOnly(true);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        <BookOpen size={21} />
                        <div>
                          <h3>{c.title}</h3>
                          <p>
                            {formatTime(c.created_at, timezone, true)} · {c.messages} メッセージ
                          </p>
                        </div>
                        <ArrowUpRight size={18} />
                      </button>
                    ))}
                  {!conversations.length && (
                    <Empty title="過去の会話も、大切な記録。">
                      インポート画面から ChatGPT のデータを取り込めます。
                    </Empty>
                  )}
                </>
              ) : filtered.length ? (
                <div className="journal-grid">{filtered.map(card)}</div>
              ) : (
                <Empty
                  title={
                    journalTab === 'anchors'
                      ? '心のよりどころを、少しずつ。'
                      : 'まだ記録はありません。'
                  }
                >
                  {journalTab === 'anchors'
                    ? '日記のしおりアイコンで、大切な瞬間を保存できます。'
                    : '気になったことを、一言だけでも書いてみましょう。'}
                </Empty>
              )}
            </>
          )}
          {view === 'import' && (
            <ImportPanel
              jobs={jobs}
              candidates={candidates}
              profile={profile}
              onRefresh={load}
              onReview={(c) => {
                const e = entries.find((e) => e.candidate_id === c.id);
                setEditor({
                  candidate: e
                    ? { ...c, ...e, id: c.id, source_message_id: c.source_message_id }
                    : c,
                });
              }}
              onSource={openSource}
              onDelete={(id) =>
                setConfirm({
                  title: 'このインポートを削除しますか？',
                  text: '他のインポートから参照されていない原文と、それに由来する候補・日記・スコアを削除します。共有された原文は保持します。',
                  action: async () => {
                    await api('imports/' + id, { method: 'DELETE' });
                    await load();
                    setToast('インポートを削除しました');
                  },
                })
              }
            />
          )}
          {view === 'insights' && (
            <InsightsPanel
              entries={entries}
              insights={insights}
              profile={profile}
              onRefresh={load}
              onSource={openSource}
              onEntry={(e) =>
                openSource({
                  id: e.id,
                  date: e.event_date,
                  label: '日記',
                  text: e.text,
                  type: 'journal',
                })
              }
            />
          )}
          {view === 'reflect' && (
            <ReflectPanel profile={profile} chats={chats} onRefresh={load} onSource={openSource} />
          )}
          {view === 'settings' && (
            <SettingsPanel
              key={profile.ai_consent + '-' + profile.timezone}
              profile={profile}
              email={user.email}
              dark={dark}
              setDark={setDark}
              onRefresh={load}
              onLogout={logout}
              onDelete={() =>
                setConfirm({
                  title: 'すべての記録を削除しますか？',
                  text: '日記、会話原文、候補、感情、アンカー、AIインサイト、対話履歴を削除します。元に戻せません。必要なら先にJSONを書き出してください。',
                  action: async () => {
                    await send('data', { confirm: 'DELETE' }, 'DELETE');
                    await load();
                    setToast('すべての記録を削除しました');
                  },
                })
              }
              onAccount={() =>
                setConfirm({
                  title: 'アカウントを完全削除しますか？',
                  text: '認証アカウントと、このアプリ内のすべての記録を削除します。元に戻せません。',
                  action: async () => {
                    await send('account', { confirm: 'DELETE' }, 'DELETE');
                    setUser(null);
                    setJobs([]);
                    setSource(null);
                  },
                })
              }
            />
          )}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {nav.map((n) => (
          <button
            key={n.id}
            className={view === n.id ? 'active' : ''}
            onClick={() => changeView(n.id)}
          >
            <n.icon size={20} strokeWidth={1.7} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      {editor && (
        <Editor
          key={editor.entry?.id || editor.candidate?.id || 'new'}
          entry={editor.entry}
          candidate={editor.candidate}
          initialEmotion={editor.emotion}
          timezone={timezone}
          aiAvailable={profile.aiAvailable}
          aiConsent={profile.ai_consent}
          uploadLimitMb={profile.uploadLimitMb}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}{' '}
      {source && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) closeSource();
          }}
          title={source.kind === 'journal' ? 'あなたの日記' : source.title}
          description="原文を確認できます。記録日時と出来事の日付は別々に表示します。"
        >
          {source.kind === 'journal' ? (
            <div className="source-detail">
              <span className="badge">
                出来事：{formatTime(source.entry.event_date, timezone, true)} ·{' '}
                {source.entry.date_kind === 'estimated'
                  ? '推定日付'
                  : source.entry.date_kind === 'unknown'
                    ? '日付不明'
                    : '確認した日付'}
              </span>
              <p className="small muted">
                記録日時：{formatTime(source.entry.recorded_at, timezone, true)} ({timezone})
              </p>
              <p className="pre original-text">{source.entry.text}</p>
              {Object.entries(emotionNames)
                .filter(([k]) => source.entry.emotions[k] !== undefined)
                .map(([k, l]) => (
                  <span className="badge" key={k}>
                    {l} {source.entry.emotions[k]}
                  </span>
                ))}
              {[
                ['body', '身体感覚'],
                ['events', '出来事'],
                ['trigger', 'きっかけ'],
                ['insights', '気づき'],
                ['success', '達成感'],
                ['conflict', '不安・葛藤'],
                ['recovery', '回復のきっかけ'],
                ['important', '大切な瞬間'],
              ].map(
                ([k, l]) =>
                  source.entry[k] && (
                    <div key={k}>
                      <h4>{l}</h4>
                      <p className="pre">{source.entry[k]}</p>
                    </div>
                  ),
              )}
              {source.entry.values.length > 0 && <p>価値観：{source.entry.values.join('、')}</p>}
              <div className="row wrap">
                <Button
                  variant="secondary"
                  onClick={() => {
                    const e = source.entry;
                    closeSource();
                    setEditor({ entry: e });
                  }}
                >
                  日記を編集
                </Button>
                {source.entry.source_message_id && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      openSource({
                        id: source.entry.source_message_id,
                        date: null,
                        label: '元の会話',
                        text: '',
                        type: 'message',
                      })
                    }
                  >
                    元の会話原文へ
                    <ArrowUpRight size={16} />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="source-detail">
              <p className="small muted">
                会話作成：{formatTime(source.created_at, timezone, true)} ·
                原文は暗号化して保持されています。
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={selectedOnly}
                  onChange={(e) => setSelectedOnly(e.target.checked)}
                />
                選択された会話経路だけを表示
              </label>
              {source.messages
                .filter((m: any) => !selectedOnly || m.on_path)
                .map((m: any) => (
                  <article
                    id={'message-' + m.id}
                    key={m.id}
                    className={
                      'original-message ' + m.role + (m.id === targetMessage ? ' highlighted' : '')
                    }
                  >
                    <div className="row between">
                      <strong>
                        {
                          (
                            {
                              user: 'あなた',
                              assistant: 'ChatGPT',
                              system: 'システム',
                              tool: 'ツール',
                            } as Record<string, string>
                          )[m.role]
                        }
                      </strong>
                      <span className="small muted">{formatTime(m.sent_at, timezone, true)}</span>
                    </div>
                    <span className="small muted">
                      {m.on_path ? '選択経路' : '別の分岐'} · ID: {m.external_id}
                    </span>
                    <p className="pre">{m.text || 'テキスト本文なし（添付・マルチモーダル等）'}</p>
                    <details>
                      <summary>親子関係・メタデータ</summary>
                      <pre>
                        {JSON.stringify(
                          { parent: m.parent, children: m.children, metadata: m.metadata },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </article>
                ))}
            </div>
          )}
        </Dialog>
      )}
      {confirm && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v && !busy) setConfirm(null);
          }}
          title={confirm.title}
          description={confirm.text}
        >
          <div className="dialog-actions">
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
              キャンセル
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await confirm.action();
                  setConfirm(null);
                } catch (e) {
                  setError((e as Error).message);
                  setConfirm(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '削除中…' : '削除する'}
            </Button>
          </div>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Auth({ onReady, error: initialError }: { onReady: () => Promise<void>; error: string }) {
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [message, setMessage] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const v = await send('auth/' + (register ? 'register' : 'login'), { email, password, name });
      if (v.verifyEmail) {
        setMessage('確認メールを開いてから、ログインしてください。');
        setRegister(false);
      } else await onReady();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <span className="brand">
          <Sun size={27} strokeWidth={1} /> inner weather
        </span>
        <div>
          <span className="eyebrow">A QUIET SPACE FOR YOUR INNER WORLD</span>
          <h1>
            心にも、
            <br />
            いろんな天気。
          </h1>
          <p>
            日々の言葉を残して、心の移ろいを眺める。
            <br />
            どんな感情も、あなたを知る手がかり。
          </p>
          <div className="weather-art">
            <div className="sun-orb" />
            <div className="cloud-shape cloud-one" />
            <div className="cloud-shape cloud-two" />
          </div>
        </div>
        <span className="small muted">観察して、理解して、受け入れる。</span>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form">
          <CloudSun size={35} strokeWidth={1.2} />
          <h2>{register ? 'あなたの空間を、つくる。' : 'おかえりなさい。'}</h2>
          <p>心の余白に、言葉を置いてみましょう。</p>
          <form onSubmit={submit}>
            {register && (
              <label>
                呼ばれたい名前
                <input
                  autoComplete="nickname"
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label>
              メールアドレス
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              パスワード
              <input
                type="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {register && (
              <p className="small muted">
                10文字以上。外部AIは、あなたが同意するまで記録を受け取りません。
              </p>
            )}
            <Button disabled={busy} type="submit">
              {busy ? '準備しています…' : register ? 'アカウントを作成' : 'ログイン'}
              <ArrowRight size={16} />
            </Button>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="success">
                {message}
              </p>
            )}
          </form>
          <button
            className="text-link auth-switch"
            onClick={() => {
              setRegister(!register);
              setError('');
            }}
          >
            {register ? 'すでにアカウントをお持ちの方' : 'はじめての方はこちら'}
          </button>
          <p className="auth-privacy">
            <ShieldCheck size={15} />
            あなたの記録は、あなたのもの。
          </p>
        </div>
      </div>
    </div>
  );
}
function Calendar({
  entries,
  timezone,
  onDay,
}: {
  entries: Entry[];
  timezone: string;
  onDay: (d: string) => void;
}) {
  const current = zonedToday(timezone);
  const [month, setMonth] = useState(current.slice(0, 7));
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
    count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  function shift(n: number) {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  }
  return (
    <div className="panel calendar">
      <div className="section-heading">
        <h3>
          {y}年 {m}月
        </h3>
        <div className="row">
          <button className="icon-btn" aria-label="前の月" onClick={() => shift(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button className="icon-btn" aria-label="次の月" onClick={() => shift(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {'日月火水木金土'.split('').map((d) => (
          <span className="calendar-weekday" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={'empty' + i} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, '0')}`,
            has = entries.some((e) => e.event_date === day);
          return (
            <button
              key={day}
              className={(day === current ? 'today ' : '') + (has ? 'has-entry' : '')}
              aria-label={`${day}${has ? ' 記録あり' : ''}`}
              onClick={() => onDay(day)}
            >
              {i + 1}
              {has && <i />}
            </button>
          );
        })}
      </div>
      <p className="small muted">
        <i className="calendar-key" /> 記録のある日
      </p>
    </div>
  );
}
