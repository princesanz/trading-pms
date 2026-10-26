import { z } from 'zod';

const timestamp = z.string().datetime({ offset: true });
export const eventSchema = z.object({
  id: z.string().uuid(), title: z.string(), currency: z.string(),
  impact: z.enum(['high', 'medium', 'low', 'holiday', 'unknown']),
  event_time: timestamp, forecast: z.string().nullable(), previous: z.string().nullable(),
});
export const articleSchema = z.object({
  id: z.string().uuid(), source: z.string(), publisher: z.string().nullable(),
  title: z.string(), url: z.string(), published_at: timestamp.nullable(),
  first_seen_at: timestamp, tickers: z.array(z.string()), topics: z.array(z.string()),
});
export const syncSchema = z.object({
  source: z.string(), last_attempt: timestamp.nullable(), last_success: timestamp.nullable(),
  status: z.enum(['never_run', 'running', 'success', 'partial', 'failed']),
});
export type EconomicEvent = z.infer<typeof eventSchema>;
export type Article = z.infer<typeof articleSchema>;
export type FeedSync = z.infer<typeof syncSchema>;
export const EVENT_COLUMNS = 'id,title,currency,impact,event_time,forecast,previous';
export const ARTICLE_COLUMNS = 'id,source,publisher,title,url,published_at,first_seen_at,tickers,topics';
// Explicit column grants: never select worker diagnostics or lease credentials.
export const SYNC_COLUMNS = 'source,last_attempt,last_success,status';
export const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'XAU', 'BTC'] as const;
export const TOPICS = {
  All: [], Energy: ['energy'], Rates: ['bonds', 'monetary_policy', 'rates'],
  Equities: ['equities', 'earnings'], Geopolitics: ['geopolitics'],
} satisfies Record<string, string[]>;
export type Topic = keyof typeof TOPICS;
export const PAGE_SIZE = 50;
export function wibDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00+07:00`);
  date.setTime(date.getTime() + days * 86_400_000);
  return wibDay(date);
}
export function wibTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${day}T00:00:00+07:00`));
}
export function articleUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function tickerTags(ticker: string): string[] {
  return ticker === 'BTC' ? ['BTC', 'BTC-USD'] : [ticker];
}
