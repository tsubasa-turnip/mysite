import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseExport, timestamp, textContent, previewExport } from '../src/lib/import-parser';
import { inferEventDate, zonedDay, chartSeries } from '../src/lib/dates';
import { localExtract, validateExtraction } from '../src/lib/ai';
import { fixture, fixtureBytes } from './fixtures';
import type { Entry } from '../src/lib/types';
describe('ChatGPT export parsing', () => {
  it('parses raw JSON and ZIP with timestamps, roles and parent references', () => {
    for (const [bytes, name] of [
      [fixtureBytes(), 'conversations.json'],
      [zipSync({ 'export/conversations.json': fixtureBytes() }), 'export.zip'],
    ] as const) {
      const p = parseExport(bytes, name);
      expect(p.conversations).toHaveLength(1);
      expect(p.conversations[0].messages).toHaveLength(5);
      const user = p.conversations[0].messages.find((m) => m.id === 'user-1')!;
      expect(user.role).toBe('user');
      expect(user.timestamp).toBe('2026-10-08T12:00:00.000Z');
      expect(user.parent).toBe('root');
      expect(user.children).toEqual(['a1', 'branch']);
    }
  });
  it('restores the selected path rather than array order', () => {
    const p = parseExport(fixtureBytes(), 'conversations.json').conversations[0];
    expect(p.messages.filter((m) => m.on_path).map((m) => m.id)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
    ]);
    expect(p.messages.find((m) => m.id === 'branch-user')?.on_path).toBe(false);
  });
  it('does not invent a selected path with ambiguous branches', () => {
    const f = fixture();
    delete (f[0] as any).current_node;
    const p = parseExport(strToU8(JSON.stringify(f)), 'file.json');
    expect(p.conversations[0].messages.every((m) => !m.on_path)).toBe(true);
    expect(p.warnings.length).toBeGreaterThan(0);
  });
  it('handles cycles without infinite traversal', () => {
    const f = fixture();
    f[0].mapping.u1.parent = 'a2';
    const p = parseExport(strToU8(JSON.stringify(f)), 'file.json');
    expect(p.conversations[0].messages.every((m) => !m.on_path)).toBe(true);
  });
  it('supports a wrapped messages-array variant', () => {
    const p = parseExport(
      strToU8(
        JSON.stringify({
          conversations: [
            {
              conversation_id: 'flat',
              messages: [
                {
                  id: 'u',
                  role: 'user',
                  timestamp: '2026-10-01T00:00:00Z',
                  content: 'I feel calm.',
                },
                { id: 'a', role: 'assistant', content: 'Okay' },
              ],
            },
          ],
        }),
      ),
      'file.json',
    );
    expect(p.conversations[0].messages.map((m) => m.text)).toEqual(['I feel calm.', 'Okay']);
  });
  it('safely skips multimodal objects and retains only text', () => {
    expect(
      textContent({
        content: {
          parts: [
            { asset_pointer: 'private-image' },
            { type: 'text', text: 'hello' },
            'world',
            null,
          ],
        },
      }),
    ).toBe('hello\nworld');
    expect(textContent({ content: { content_type: 'image', text: 'not text' } })).toBe('');
  });
  it('rejects malformed roots and tolerates unsupported individual records', () => {
    expect(() => parseExport(strToU8('{}'), 'x.json')).toThrow();
    const f = fixture();
    (f as any[]).push(null, { id: 'missing' });
    const p = parseExport(strToU8(JSON.stringify(f)), 'x.json');
    expect(p.conversations).toHaveLength(1);
    expect(p.warnings.length).toBeGreaterThan(0);
  });
  it('rejects traversal, duplicate target, zip bombs and checksum tampering', () => {
    expect(() =>
      parseExport(zipSync({ '../conversations.json': fixtureBytes() }), 'x.zip'),
    ).toThrow(/パス/);
    expect(() =>
      parseExport(
        zipSync({ 'a/conversations.json': fixtureBytes(), 'b/conversations.json': fixtureBytes() }),
        'x.zip',
      ),
    ).toThrow(/複数/);
    expect(() =>
      parseExport(zipSync({ 'conversations.json': strToU8('a'.repeat(100000)) }), 'x.zip'),
    ).toThrow(/圧縮率/);
    const bytes = zipSync({ 'conversations.json': fixtureBytes() });
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 20; i++)
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 16, 123, true);
        break;
      }
    expect(() => parseExport(bytes, 'x.zip')).toThrow(/チェックサム/);
  });
  it('preview is read-only and discloses processing scope', () => {
    const p = previewExport(parseExport(fixtureBytes(), 'x.json'));
    expect(p.count).toBe(1);
    expect(p.messages).toBe(5);
    expect(p.transmission).toContain('assistant/system/tool');
    expect(p.estimatedTokens).toBeGreaterThan(0);
  });
});
describe('dates, extraction and chart semantics', () => {
  it('converts explicit UTC instants to user timezone and preserves zero timestamps', () => {
    expect(timestamp(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(zonedDay('2026-10-08T23:30:00Z', 'Asia/Tokyo')).toBe('2026-10-09');
    expect(timestamp('2026-10-08T12:00:00')).toBeNull();
  });
  it('separates event dates from message dates without fabricating a year', () => {
    expect(inferEventDate('2026年10月4日は不安だった', '2026-10-08T12:00:00Z')).toEqual({
      event_date: '2026-10-04',
      date_kind: 'explicit',
    });
    expect(inferEventDate('10月4日は不安だった', '2026-10-08T12:00:00Z')).toEqual({
      event_date: '2026-10-04',
      date_kind: 'estimated',
    });
    expect(inferEventDate('昨日は不安だった', '2026-10-08T12:00:00Z').event_date).toBeNull();
    expect(inferEventDate('10月4日は不安だった', null).event_date).toBeNull();
    expect(inferEventDate('2026年2月30日', null).event_date).toBeNull();
  });
  it('labels local extraction as inferred and leaves metrics unrecorded', () => {
    const c = localExtract('私は不安だけど、感謝も感じる。', null);
    expect(c.emotions).toEqual({ anxiety: 5, gratitude: 5 });
    expect(c.inferred).toBe(true);
    expect(c.energy).toBeNull();
    expect(c.date_kind).toBe('unknown');
  });
  it('validates structured extraction, evidence, intensity and dates', () => {
    const text = '2026年10月4日は不安だった。';
    const c = localExtract(text, null);
    const raw = { ...c, emotions: [{ emotion: 'anxiety', intensity: 4 }] };
    delete (raw as any).method;
    expect(validateExtraction(raw, text, null).event_date).toBe('2026-10-04');
    expect(() => validateExtraction({ ...raw, confidence: 5 }, text, null)).toThrow();
    expect(() => validateExtraction({ ...raw, evidence: 'AI invented it' }, text, null)).toThrow();
    expect(() =>
      validateExtraction({ ...raw, emotions: [{ emotion: 'anxiety', intensity: 11 }] }, text, null),
    ).toThrow();
    expect(() => validateExtraction({ ...raw, extra: 'injected' }, text, null)).toThrow();
  });
  it('distinguishes null from zero and omits unknown dates', () => {
    const c = localExtract('note', null);
    const entries = [
      { ...c, id: 'zero', event_date: '2026-10-04', emotions: { anxiety: 0 }, energy: 0 },
      { ...c, id: 'unknown', event_date: null, emotions: { anxiety: 10 } },
    ] as unknown as Entry[];
    const points = chartSeries(entries, '2026-10-04', '2026-10-05');
    expect(points[0].anxiety).toBe(0);
    expect(points[0].energy).toBe(0);
    expect(points[0].joy).toBeNull();
    expect(points[1].anxiety).toBeNull();
    expect(points[0].entryIds).toEqual(['zero']);
  });
});
