'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Download, AudioLines } from 'lucide-react';
import { Button } from './ui/button';
export function Voice({
  onText,
  aiAvailable,
  aiConsent,
  uploadLimitMb,
}: {
  onText: (v: string) => void;
  aiAvailable: boolean;
  aiConsent: boolean;
  uploadLimitMb: number;
}) {
  const audioLimitMb = Math.min(11, uploadLimitMb);
  const [recording, setRecording] = useState(false),
    [blob, setBlob] = useState<Blob | null>(null),
    [url, setUrl] = useState(''),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      recorder.current?.state === 'recording' && recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  async function start() {
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          '録音に対応していないブラウザです。HTTPS または音声ファイル選択をお試しください',
        );
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = ['audio/webm', 'audio/mp4'].find((v) => MediaRecorder.isTypeSupported(v));
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        setBlob(new Blob(chunks, { type: r.mimeType }));
        s.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (timer.current) clearTimeout(timer.current);
      };
      r.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (r.state === 'recording') r.stop();
      }, 180000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '録音できません');
    }
  }
  async function transcribe() {
    if (!blob) return;
    if (blob.size > audioLimitMb * 1024 * 1024) {
      setError(`音声は${audioLimitMb} MB以下にしてください`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.append('file', blob, 'recording.' + (blob.type.includes('mp4') ? 'm4a' : 'webm'));
      data.append('consent', String(consent));
      const r = await fetch('/api/transcribe', { method: 'POST', body: data });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      onText(v.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : '文字起こしに失敗しました');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="voice-box">
      <div className="row">
        <AudioLines size={18} />
        <strong>声で、今の気持ちを残す</strong>
      </div>
      <p className="small muted">
        録音はこの画面だけで保持されます（最大3分）。文字起こし用の音声は{audioLimitMb} MB以下です。
        文字起こし後は日記として保存してください。
      </p>
      <div className="row wrap">
        <Button
          type="button"
          variant="secondary"
          onClick={() => (recording ? recorder.current?.stop() : start())}
        >
          <>{recording ? <Square size={15} /> : <Mic size={15} />}</>
          {recording ? '録音を停止' : '録音する'}
        </Button>
        <label className="file-label">
          音声を選択
          <input
            type="file"
            accept="audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/ogg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > audioLimitMb * 1024 * 1024) {
                  setError(`音声は${audioLimitMb} MB以下にしてください`);
                  return;
                }
                setBlob(f);
              }
            }}
          />
        </label>
        {recording && <span className="recording">録音中</span>}
      </div>
      {url && (
        <>
          <audio controls src={url} />
          <a className="text-link" href={url} download="inner-weather-recording">
            <Download size={14} />
            録音を保存
          </a>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            この音声を OpenAI へ送信して文字起こしすることに同意します（目安 $0.006/分）
          </label>
          <Button
            type="button"
            disabled={!consent || !aiAvailable || !aiConsent || busy}
            variant="secondary"
            onClick={transcribe}
          >
            {busy ? '文字起こし中…' : '文字起こしする'}
          </Button>
          {(!aiAvailable || !aiConsent) && (
            <p className="small muted">
              文字起こしには OpenAI
              設定とプライバシー設定での同意が必要です。録音はダウンロードできます。
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
