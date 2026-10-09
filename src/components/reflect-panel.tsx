'use client';
import { useState } from 'react';
import { Send, MessagesSquare } from 'lucide-react';
import { send } from '@/lib/client';
import type { Source } from '@/lib/types';
import { Button } from './ui/button';
import { AiControl, Sources } from './shared';
export function ReflectPanel({
  profile,
  chats,
  onRefresh,
  onSource,
}: {
  profile: any;
  chats: any[];
  onRefresh: () => Promise<void>;
  onSource: (s: Source) => void;
}) {
  const [question, setQuestion] = useState(''),
    [method, setMethod] = useState<'local' | 'openai'>('local'),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError('');
    try {
      await send('reflect', { question, method, consent });
      setQuestion('');
      setConsent(false);
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
          <span className="eyebrow">A CONVERSATION WITH YOURSELF</span>
          <h1>過去の私に、聞いてみる。</h1>
          <p>あのときの言葉が、今のあなたを支えてくれるかもしれません。</p>
        </div>
        <MessagesSquare size={32} className="heading-icon" />
      </div>
      <div className="reflect-intro">
        <span className="orb small-orb" />
        <h2>あなたの記録に、耳をすませる。</h2>
        <p>
          日記と過去の会話から、関連するユーザー発言を探します。
          <br />
          回答には、日付と原文への参照を添えます。
        </p>
        <div className="prompt-chips">
          {[
            '半年前の自分は何に悩んでいた？',
            '仕事で自信を失ったとき、どう回復した？',
            '最近、自分の価値観はどう変わった？',
            '人とのつながりを感じた出来事を教えて',
          ].map((q) => (
            <button key={q} onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>
      <div className="chat-list" aria-live="polite">
        {chats.map((c) => (
          <div key={c.id} className={'chat-message ' + c.role}>
            <span className="small muted">
              {c.role === 'user'
                ? 'あなた'
                : c.method === 'openai'
                  ? 'Inner Weather · AIの推測'
                  : 'Inner Weather · 原文検索'}
            </span>
            <p className="pre">{c.text}</p>
            {c.role === 'assistant' && c.usage && (
              <p className="small muted">
                {(c.usage.input + c.usage.output).toLocaleString()} tokens · $
                {Number(c.usage.cost).toFixed(4)}（概算）
              </p>
            )}
            {c.sources && (
              <Sources sources={c.sources} onOpen={onSource} timezone={profile.timezone} />
            )}
          </div>
        ))}
      </div>
      <div className="panel chat-composer">
        <AiControl
          method={method}
          setMethod={setMethod}
          consent={consent}
          setConsent={setConsent}
          available={profile.aiAvailable}
          allowed={profile.ai_consent}
          scope="質問と、関連するユーザー発言・確認済み日記の最大12件（各本文3,000文字、日付、確認済み項目1,000文字まで）を送信します。assistant/system/tool 発言は送信しません。"
        />
        <p className="small muted">
          外部AIの推測は診断ではありません。会話原文の日付は記録日時、日記の日付は出来事の日付です。
        </p>
        <form onSubmit={ask} className="row">
          <label className="sr-only" htmlFor="reflect-question">
            過去の自分への質問
          </label>
          <textarea
            id="reflect-question"
            rows={2}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="過去の自分に、聞いてみたいこと…"
          />
          <Button
            aria-label="質問を送信"
            disabled={!question.trim() || busy || (method === 'openai' && !consent)}
            type="submit"
          >
            {busy ? '検索中…' : <Send size={18} />}
          </Button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
