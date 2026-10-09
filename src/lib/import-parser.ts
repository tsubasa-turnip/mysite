import { unzipSync, strFromU8 } from 'fflate';
import { hash } from './crypto';
import { AppError } from './validation';
import type { NormalConversation, NormalMessage, ImportPreview } from './types';
export const UPLOAD_MB = Math.min(25, Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 25));
export const MAX_UPLOAD = UPLOAD_MB * 1024 * 1024;
const MAX_EXPANDED = 100 * 1024 * 1024;
const MAX_JSON = 50 * 1024 * 1024;
const MAX_MESSAGES = 50000;
const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
export function timestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  let date: Date;
  if (typeof value === 'number') date = new Date(value < 1e12 ? value * 1000 : value);
  else if (typeof value === 'string') {
    // Strings without an explicit zone are ambiguous and must not be treated as host-local time.
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
    date = new Date(value);
  } else return null;
  return Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() < 1970 ||
    date.getUTCFullYear() > 2200
    ? null
    : date.toISOString();
}
export function textContent(message: Record<string, any>): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  const c = obj(content);
  const parts = Array.isArray(c.parts) ? c.parts : Array.isArray(c.content) ? c.content : [];
  const texts = parts.flatMap((part: unknown) => {
    if (typeof part === 'string') return [part];
    const p = obj(part);
    return (p.type === 'text' || p.content_type === 'text' || p.type === 'input_text') &&
      typeof p.text === 'string'
      ? [p.text]
      : [];
  });
  if (texts.length) return texts.join('\n');
  return typeof c.text === 'string' && (!c.content_type || c.content_type === 'text') ? c.text : '';
}
function zipJson(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) throw new AppError(400, 'ZIP の構造が不正です');
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    offset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    count === 65535 ||
    size === 0xffffffff ||
    offset === 0xffffffff ||
    count > 10000 ||
    offset + size !== end
  )
    throw new AppError(400, '分割・ZIP64 または巨大な ZIP には対応していません');
  let pos = offset,
    total = 0;
  let target = '';
  let expectedCrc = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50)
      throw new AppError(400, 'ZIP のディレクトリが不正です');
    const flags = view.getUint16(pos + 8, true),
      compressed = view.getUint32(pos + 20, true),
      original = view.getUint32(pos + 24, true);
    const n = view.getUint16(pos + 28, true),
      extra = view.getUint16(pos + 30, true),
      comment = view.getUint16(pos + 32, true);
    if (pos + 46 + n + extra + comment > end) throw new AppError(400, 'ZIP のファイル名が不正です');
    const name = strFromU8(bytes.subarray(pos + 46, pos + 46 + n));
    if (
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').some((p) => p === '..' || p === '.') ||
      names.has(name)
    )
      throw new AppError(400, '安全でない ZIP パスです');
    names.add(name);
    const unixType = (view.getUint32(pos + 38, true) >>> 16) & 0xf000;
    if (flags & 1 || unixType === 0xa000 || view.getUint16(pos + 34, true) !== 0)
      throw new AppError(400, '暗号化 ZIP・シンボリックリンクには対応していません');
    total += original;
    if (total > MAX_EXPANDED || original > MAX_JSON || original / Math.max(compressed, 1) > 100)
      throw new AppError(413, 'ZIP の展開サイズまたは圧縮率が上限を超えています');
    if (name.split('/').at(-1) === 'conversations.json') {
      if (target) throw new AppError(400, 'conversations.json が複数あります');
      target = name;
      expectedCrc = view.getUint32(pos + 16, true);
    }
    pos += 46 + n + extra + comment;
  }
  if (pos !== end || !target)
    throw new AppError(400, 'ZIP 内に conversations.json が見つかりません');
  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(bytes, {
      filter: (f) => f.name === target && f.originalSize <= MAX_JSON,
    });
  } catch {
    throw new AppError(400, 'ZIP を展開できません');
  }
  const json = extracted[target];
  if (!json || json.length > MAX_JSON || crc32(json) !== expectedCrc)
    throw new AppError(400, 'ZIP のチェックサムまたは展開サイズが不正です');
  return json;
}
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function parseExport(bytes: Uint8Array, filename: string) {
  if (bytes.length > MAX_UPLOAD) throw new AppError(413, `アップロード上限は ${UPLOAD_MB} MB です`);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip && !filename.toLowerCase().endsWith('.json'))
    throw new AppError(400, '公式エクスポートの ZIP または JSON を選択してください');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(isZip ? zipJson(bytes) : bytes));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, 'JSON を解析できません');
  }
  const root = obj(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(root.conversations)
      ? root.conversations
      : Array.isArray(root.items)
        ? root.items
        : null;
  if (!list) throw new AppError(400, '対応する会話配列が見つかりません');
  if (list.length > 10000) throw new AppError(413, '会話数の上限は 10,000 件です');
  const conversations: NormalConversation[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  let messageCount = 0;
  let skipped = 0;
  for (let index = 0; index < list.length; index++) {
    const c = obj(list[index]);
    const id = String(c.id || c.conversation_id || '');
    if (!id || id.length > 200 || ids.has(id)) {
      skipped++;
      continue;
    }
    ids.add(id);
    const mapping = obj(c.mapping);
    const messages: NormalMessage[] = [];
    const nodes = new Map<string, Record<string, any>>();
    if (Object.keys(mapping).length)
      for (const [nodeId, node] of Object.entries(mapping)) nodes.set(nodeId, obj(node));
    else if (Array.isArray(c.messages))
      for (let i = 0; i < c.messages.length; i++) {
        const m = obj(c.messages[i]);
        const mid = String(m.id || '');
        if (mid)
          nodes.set(mid, {
            id: mid,
            message: m,
            parent: Object.hasOwn(m, 'parent') ? m.parent : (c.messages[i - 1]?.id ?? null),
            children: m.children ?? (c.messages[i + 1]?.id ? [c.messages[i + 1].id] : []),
          });
      }
    else {
      skipped++;
      continue;
    }
    if (nodes.size > MAX_MESSAGES || messageCount + nodes.size > MAX_MESSAGES)
      throw new AppError(413, 'メッセージ数の上限は 50,000 件です');
    // Prefer the selected current_node. Fall back only to an unambiguous leaf; never guess a branch.
    let current =
      typeof c.current_node === 'string' && nodes.has(c.current_node) ? c.current_node : null;
    if (!current) {
      const parents = new Set([...nodes.values()].map((n) => n.parent).filter(Boolean));
      const leaves = [...nodes.keys()].filter((n) => !parents.has(n));
      if (leaves.length === 1) current = leaves[0];
      else warnings.push(`会話 ${index + 1}: 選択経路が不明なため自動抽出の対象外です`);
    }
    const selected = new Set<string>();
    let cursor = current;
    let badPath = false;
    while (cursor) {
      if (selected.has(cursor) || !nodes.has(cursor)) {
        badPath = true;
        break;
      }
      selected.add(cursor);
      const parent = nodes.get(cursor)?.parent;
      cursor = typeof parent === 'string' ? parent : null;
    }
    if (badPath) {
      selected.clear();
      warnings.push(`会話 ${index + 1}: 循環または欠損した親子関係を検出しました`);
    }
    const messageIds = new Set<string>();
    for (const [nodeId, node] of nodes) {
      const m = obj(node.message);
      const mid = String(m.id || nodeId);
      if (!mid || mid.length > 200 || messageIds.has(mid)) {
        skipped++;
        continue;
      }
      messageIds.add(mid);
      const role = String(obj(m.author).role || m.role || '');
      if (!['user', 'assistant', 'system', 'tool'].includes(role)) {
        skipped++;
        continue;
      }
      const text = textContent(m);
      if (text.length > 1_000_000) throw new AppError(413, '個別メッセージが大きすぎます');
      const { content: _content, ...metadata } = m;
      messages.push({
        id: mid,
        parent: typeof node.parent === 'string' ? node.parent : null,
        children: Array.isArray(node.children)
          ? node.children.filter((v: unknown) => typeof v === 'string')
          : [],
        role: role as NormalMessage['role'],
        text,
        timestamp: timestamp(m.create_time ?? m.created_at ?? m.timestamp),
        on_path: selected.has(nodeId),
        metadata: { ...metadata, node_id: nodeId },
      });
    }
    messageCount += nodes.size;
    const { mapping: _mapping, messages: _messages, ...metadata } = c;
    conversations.push({
      id,
      title: typeof c.title === 'string' ? c.title.slice(0, 1000) : '無題の会話',
      created_at: timestamp(c.create_time ?? c.created_at),
      updated_at: timestamp(c.update_time ?? c.updated_at),
      current_node: current,
      messages,
      metadata,
    });
  }
  if (skipped) warnings.push(`${skipped} 件の空・不明・重複レコードを安全にスキップしました`);
  if (!conversations.length) throw new AppError(400, '解析できる会話がありません');
  return { conversations, warnings: warnings.slice(0, 100), fingerprint: hash(bytes) };
}
export function previewExport(parsed: ReturnType<typeof parseExport>): ImportPreview {
  const messages = parsed.conversations.flatMap((c) => c.messages);
  const dates = [
    ...messages.map((m) => m.timestamp),
    ...parsed.conversations.map((c) => c.created_at),
  ]
    .filter((v): v is string => !!v)
    .sort();
  const chars = messages
    .filter((m) => m.role === 'user' && m.on_path && isRelevant(m.text))
    .reduce((a, m) => a + m.text.length, 0);
  const tokens = Math.ceil(chars * 1.5);
  const batches = messages
    .filter((m) => m.role === 'user' && m.on_path && isRelevant(m.text))
    .reduce((a, m) => a + splitMessage(m.text).length, 0);
  return {
    conversations: parsed.conversations.map((c) => ({
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      messages: c.messages.length,
      users: c.messages.filter((m) => m.role === 'user' && m.on_path).length,
    })),
    count: parsed.conversations.length,
    messages: messages.length,
    period: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    warnings: parsed.warnings,
    fingerprint: parsed.fingerprint,
    estimateSeconds: Math.max(1, batches * 5),
    estimatedTokens: tokens + batches * 1200,
    estimatedCost: estimateCost(tokens + batches * 1200, batches * 600),
    aiAvailable: !!(process.env.OPENAI_API_KEY || process.env.IW_OPENAI_API_KEY),
    transmission:
      '選択経路の user 発言のうち、経験・感情に関連する本文を最大3,000文字ずつ送信します。会話タイトル・assistant/system/tool発言・添付ファイルは送信しません。メッセージ日時は出来事日付の判断用に送信します。',
  };
}
export function isRelevant(text: string) {
  return /(私|わたし|僕|自分|気持ち|感じ|不安|嬉し|悲し|疲れ|仕事|大切|悩|感謝|痛|回復|楽しい|安心|孤独|今日|昨日|\bI\b|\bmy\b|feel|anxious|happy|sad|stress|grateful|worried|lonely)/i.test(
    text,
  );
}
export function splitMessage(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 3000) chunks.push(text.slice(i, i + 3000));
  return chunks;
}
export function estimateCost(input: number, output: number) {
  return (
    (input * Number(process.env.AI_INPUT_USD_PER_MILLION || 0.4)) / 1e6 +
    (output * Number(process.env.AI_OUTPUT_USD_PER_MILLION || 1.6)) / 1e6
  );
}
