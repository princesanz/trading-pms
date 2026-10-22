import { createHash } from 'node:crypto';
import { z } from 'zod';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const text = z.string().trim().min(1).max(1000);
export const nullableText = z.string().trim().max(1000).nullish()
  .transform(v => v || null);
export const urlSchema = z.string().max(4096).url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
export const timestamp = z.iso.datetime({ offset: true });
export const eventSchema = z.object({
  event_key: z.string().regex(/^[a-f0-9]{64}$/),
  title: text,
  currency: z.string().regex(/^([A-Z]{3}|ALL)$/),
  impact: z.enum(['high', 'medium', 'low', 'holiday', 'unknown']),
  event_time: timestamp,
  forecast: nullableText,
  previous: nullableText,
});
export const newsSchema = z.object({
  source_item_key: z.string().min(1).max(2048),
  publisher: nullableText,
  title: text,
  url: urlSchema,
  canonical_url: urlSchema,
  published_at: timestamp.nullable(),
  tickers: z.array(z.string().regex(/^[A-Z0-9.^=-]{1,20}$/)).max(100),
  topics: z.array(z.string().min(1).max(40)).max(30),
});
export type EventRow = z.infer<typeof eventSchema>;
export type NewsRow = z.infer<typeof newsSchema>;
export type Row = EventRow | NewsRow;
export interface Batch { rows: Row[]; fetched: number; rejected: number }
export interface Feed {
  id: string;
  url: string;
  parse: (body: string) => Batch;
}

export function canonicalUrl(input: string): string {
  const url = new URL(urlSchema.parse(input));
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid|guccounter|guce_referrer|guce_referrer_sig)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  // Preserve semantic parameters, their ordering, path casing and trailing slash.
  return url.toString();
}

export function publicationTime(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  // Do not interpret timezone-less strings in the worker host's local timezone.
  if (typeof input === 'string' && !/(Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(input)) return null;
  const date = new Date(typeof input === 'number' ? input * 1000 : input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function topicsFor(title: string): string[] {
  const rules: Record<string, RegExp> = {
    energy: /\b(oil|crude|opec|energy|gas|petroleum|brent)\b/i,
    bonds: /\b(bonds?|treasur(?:y|ies)|yields?|debt|gilts?)\b/i,
    geopolitics: /\b(war|military|sanctions?|geopolitic\w*|missile|ceasefire|invasion)\b/i,
    monetary_policy: /\b(fed|federal reserve|ecb|boe|boj|central bank|interest rates?)\b/i,
    technology: /\b(ai|artificial intelligence|chips?|semiconductor|software|technology)\b/i,
    earnings: /\b(earnings|quarterly results|revenue|eps)\b/i,
  };
  return Object.entries(rules).filter(([, pattern]) => pattern.test(title)).map(([topic]) => topic);
}

export function deduplicate(rows: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const row of rows) {
    const key = 'event_key' in row ? row.event_key : row.source_item_key;
    const old = map.get(key);
    if (old && 'tickers' in old && 'tickers' in row) {
      map.set(key, {
        ...row,
        publisher: row.publisher ?? old.publisher,
        published_at: row.published_at ?? old.published_at,
        tickers: [...new Set([...old.tickers, ...row.tickers])].sort(),
        topics: [...new Set([...old.topics, ...row.topics])].sort(),
      });
    } else if (old && 'event_key' in old && 'event_key' in row) {
      map.set(key, { ...row, forecast: row.forecast ?? old.forecast, previous: row.previous ?? old.previous });
    } else map.set(key, row);
  }
  return [...map.values()];
}

export function parseItems(items: unknown[], convert: (item: unknown) => Row): Batch {
  if (items.length > 500) throw new Error('Feed exceeds 500 items; refusing truncated ingestion');
  const rows: Row[] = [];
  let rejected = 0;
  for (const item of items) {
    try { rows.push(convert(item)); } catch { rejected++; }
  }
  return { rows: deduplicate(rows), fetched: items.length, rejected };
}
