export const emotionNames = {
  joy: '喜び',
  calm: '穏やか',
  anxiety: '不安',
  sadness: '悲しみ',
  anger: '怒り',
  gratitude: '感謝',
  hope: '希望',
  loneliness: '孤独',
} as const;
export type Emotion = keyof typeof emotionNames;
export type Scores = Partial<Record<Emotion, number>>;
export type DateKind = 'explicit' | 'estimated' | 'unknown';
export type JournalContent = {
  text: string;
  emotions: Scores;
  energy: number | null;
  stress: number | null;
  mood: number | null;
  body: string;
  events: string;
  insights: string;
  values: string[];
  trigger: string;
  success: string;
  conflict: string;
  recovery: string;
  important: string;
};
export type Entry = JournalContent & {
  id: string;
  recorded_at: string;
  event_date: string | null;
  date_kind: DateKind;
  source_message_id: string | null;
  candidate_id: string | null;
  anchor: boolean;
};
export type Source = {
  id: string;
  date: string | null;
  label: string;
  text: string;
  type: 'journal' | 'message';
  source_message_id?: string;
  conversation_id?: string;
  context?: Record<string, unknown>;
};
export type CandidateContent = JournalContent & {
  event_date: string | null;
  date_kind: DateKind;
  inferred: boolean;
  confidence: number;
  evidence: string;
  method: 'local' | 'openai';
};
export type Candidate = CandidateContent & {
  id: string;
  source_message_id: string;
  recorded_at: string | null;
  status: string;
  conversation_title: string;
};
export type NormalMessage = {
  id: string;
  parent: string | null;
  children: string[];
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  timestamp: string | null;
  on_path: boolean;
  metadata: Record<string, unknown>;
};
export type NormalConversation = {
  id: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  current_node: string | null;
  messages: NormalMessage[];
  metadata: Record<string, unknown>;
};
export type ImportPreview = {
  conversations: {
    id: string;
    title: string;
    created_at: string | null;
    messages: number;
    users: number;
  }[];
  count: number;
  messages: number;
  period: { from: string | null; to: string | null };
  warnings: string[];
  fingerprint: string;
  estimateSeconds: number;
  estimatedTokens: number;
  estimatedCost: number;
  aiAvailable: boolean;
  transmission: string;
};

export type ImportJob = {
  stage: 'ingest' | 'extract';
  ingest_cursor: number;
  ingest_total: number;
  added: number;
  duplicates: number;
  id: string;
  fingerprint: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  method: 'local' | 'openai';
  total: number;
  processed: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error: string | null;
  created_at: string;
  consent_at: string | null;
  lease_until: string | null;
  warnings: string[];
};
