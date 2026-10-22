import { setTimeout as sleep } from 'node:timers/promises';

export class FeedError extends Error {
  constructor(public readonly code: string, public readonly retryAt: string | null = null) { super(code); }
}
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : null;
}
interface HttpOptions {
  fetcher?: typeof fetch;
  wait?: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
  maxBytes?: number;
}
export async function fetchFeed(url: string, options: HttpOptions = {}): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? sleep;
  const maxBytes = options.maxBytes ?? 2_000_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    let delay: number | null = null;
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': 'SanzCapital-NewsIngest/1.0', Accept: 'application/json, application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        redirect: 'error',
      });
      if (!response.ok) {
        delay = retryAfterMs(response.headers.get('retry-after'));
        await response.body?.cancel();
        const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        const retryAt = delay === null ? null : new Date(Date.now() + delay).toISOString();
        if (!retryable || attempt === 2) throw new FeedError(`HTTP_${response.status}`, retryAt);
        // Do not shorten a provider's requested wait. Defer to the next scheduled run.
        if (delay !== null && delay > 30_000) throw new FeedError(`RETRY_DEFERRED_HTTP_${response.status}`, retryAt);
      } else {
        if (Number(response.headers.get('content-length')) > maxBytes) {
          await response.body?.cancel();
          throw new FeedError('BODY_TOO_LARGE');
        }
        if (!response.body) throw new FeedError('EMPTY_BODY');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
              await reader.cancel();
              throw new FeedError('BODY_TOO_LARGE');
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        return Buffer.concat(chunks).toString('utf8');
      }
    } catch (error) {
      if (error instanceof FeedError) throw error;
      if (attempt === 2) throw new FeedError('NETWORK_OR_TIMEOUT');
    }
    await wait(delay ?? Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), 5000));
  }
  throw new FeedError('RETRIES_EXHAUSTED');
}
