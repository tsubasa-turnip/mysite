import type { DateKind, Entry } from './types';
export function zonedDay(date: string, timezone = 'Asia/Tokyo') {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(date));
  return `${p.find((v) => v.type === 'year')?.value}-${p.find((v) => v.type === 'month')?.value}-${p.find((v) => v.type === 'day')?.value}`;
}
export function inferEventDate(
  text: string,
  sentAt: string | null,
): { event_date: string | null; date_kind: DateKind } {
  const unknown = { event_date: null, date_kind: 'unknown' as const };
  const valid = (y: number, m: number, d: number) => {
    const value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
      ? value
      : null;
  };
  const explicit: (string | null)[] = [];
  for (const match of text.matchAll(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/g))
    explicit.push(valid(+match[1], +match[2], +match[3]));
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const monthWords = months.join('|');
  for (const match of text.matchAll(
    new RegExp(`(${monthWords}) ([0-9]{1,2})(?:st|nd|rd|th)?[,]? (20[0-9]{2})`, 'gi'),
  ))
    explicit.push(valid(+match[3], months.indexOf(match[1].toLowerCase()) + 1, +match[2]));
  for (const match of text.matchAll(
    new RegExp(`([0-9]{1,2})(?:st|nd|rd|th)? (${monthWords}) (20[0-9]{2})`, 'gi'),
  ))
    explicit.push(valid(+match[3], months.indexOf(match[2].toLowerCase()) + 1, +match[1]));
  // A candidate can contain several events. Do not collapse conflicting dates to the first.
  if (explicit.length) {
    const dates = [...new Set(explicit)];
    return dates.length === 1 && dates[0]
      ? { event_date: dates[0], date_kind: 'explicit' }
      : unknown;
  }
  const partial = [...text.matchAll(/(?<!\d)(\d{1,2})月(\d{1,2})日/g)];
  if (partial.length && sentAt) {
    const dates = [
      ...new Set(partial.map((m) => valid(new Date(sentAt).getUTCFullYear(), +m[1], +m[2]))),
    ];
    return dates.length === 1 && dates[0]
      ? { event_date: dates[0], date_kind: 'estimated' }
      : unknown;
  }
  // Relative dates need the original speaker's timezone, not the current viewer's timezone.
  return unknown;
}
export function chartSeries(entries: Entry[], from: string, to: string) {
  const days = new Map<string, Record<string, number[]>>();
  for (const e of entries) {
    if (!e.event_date || e.event_date < from || e.event_date > to) continue;
    const d = days.get(e.event_date) || {};
    for (const [k, v] of Object.entries({
      ...e.emotions,
      energy: e.energy,
      stress: e.stress,
      mood: e.mood,
    }))
      if (typeof v === 'number') (d[k] ??= []).push(v);
    days.set(e.event_date, d);
  }
  const result: Record<string, unknown>[] = [];
  const cursor = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cursor <= end && result.length < 367) {
    const date = cursor.toISOString().slice(0, 10),
      values = days.get(date) || {};
    const point: Record<string, unknown> = {
      date,
      entryIds: entries.filter((e) => e.event_date === date).map((e) => e.id),
    };
    for (const k of [
      'joy',
      'calm',
      'anxiety',
      'sadness',
      'anger',
      'gratitude',
      'hope',
      'loneliness',
      'energy',
      'stress',
      'mood',
    ])
      point[k] = values[k]?.length ? values[k].reduce((a, b) => a + b, 0) / values[k].length : null;
    result.push(point);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}
