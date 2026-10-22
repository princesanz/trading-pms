import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { feeds } from './adapters.ts';
import { FeedError, fetchFeed } from './http.ts';
import type { Batch, Feed } from './model.ts';

export interface Store {
  claim: (source: string) => Promise<string | null>;
  finish: (source: string, token: string, batch: Batch, error?: string, retryAt?: string | null) => Promise<void>;
}
export function supabaseStore(client: SupabaseClient): Store {
  return {
    async claim(source) {
      const { data, error } = await client.rpc('news_claim_feed', { p_source: source });
      if (error) throw new FeedError('DATABASE_CLAIM_FAILED');
      return z.uuid().nullable().parse(data);
    },
    async finish(source, token, batch, errorMessage, retryAt) {
      const { error } = await client.rpc('news_finish_feed', {
        p_source: source, p_token: token, p_rows: batch.rows,
        p_fetched: batch.fetched, p_rejected: batch.rejected,
        p_error: errorMessage ?? null, p_retry_at: retryAt ?? null,
      });
      if (error) throw new FeedError('DATABASE_COMMIT_FAILED');
    },
  };
}
export interface Result {
  source: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  fetched?: number;
  rejected?: number;
  written?: number;
  error?: string;
  retryAt?: string | null;
}
export async function runFeed(feed: Feed, store: Store | null, fetcher = fetchFeed): Promise<Result> {
  let token: string | null = null;
  let batch: Batch = { rows: [], fetched: 0, rejected: 0 };
  try {
    if (store) {
      token = await store.claim(feed.id);
      if (!token) return { source: feed.id, status: 'skipped' };
    }
    const body = await fetcher(feed.url);
    try { batch = feed.parse(body); } catch { throw new FeedError('INVALID_FEED_PAYLOAD'); }
    if (batch.fetched > 0 && batch.rows.length === 0) throw new FeedError('ALL_ITEMS_REJECTED');
    if (store && token) await store.finish(feed.id, token, batch);
    return {
      source: feed.id, status: batch.rejected ? 'partial' : 'success',
      fetched: batch.fetched, rejected: batch.rejected, written: store ? batch.rows.length : 0,
    };
  } catch (error) {
    // Never log raw response bodies, URLs with secrets, or database error details.
    const code = error instanceof FeedError ? error.code : 'UNEXPECTED_WORKER_FAILURE';
    const retryAt = error instanceof FeedError ? error.retryAt : null;
    if (store && token) {
      try { await store.finish(feed.id, token, { ...batch, rows: [] }, code, retryAt); }
      catch {
        // Ambiguous commit or database outage: leave the lease to expire.
        return { source: feed.id, status: 'failed', error: `${code}:STATE_UPDATE_UNCONFIRMED`, retryAt };
      }
    }
    return { source: feed.id, status: 'failed', error: code, retryAt };
  }
}

export async function runFeeds(list: Feed[], store: Store | null, fetcher = fetchFeed): Promise<Result[]> {
  // Serial endpoints keep pressure on Yahoo low. Failure does not stop other feeds.
  const results: Result[] = [];
  for (const feed of list) {
    const result = await runFeed(feed, store, fetcher);
    results.push(result);
    console.log(JSON.stringify({ at: new Date().toISOString(), dryRun: !store, ...result }));
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run' && !arg.startsWith('--source='))) {
    throw new FeedError('UNKNOWN_ARGUMENT');
  }
  const dryRun = args.includes('--dry-run');
  const tickers = z.array(z.string().regex(/^[A-Z0-9.^=-]{1,20}$/)).min(1).max(50)
    .parse([...new Set((process.env.NEWS_TICKERS ?? 'AAPL,MSFT,NVDA,TSLA,META')
      .split(',').map(t => t.trim().toUpperCase()))]);
  const onlySource = args.find(arg => arg.startsWith('--source='))?.slice('--source='.length);
  const selected = feeds(tickers).filter(feed => !onlySource || feed.id === onlySource);
  if (!selected.length) throw new FeedError('UNKNOWN_SOURCE');
  let store: Store | null = null;
  if (!dryRun) {
    const env = z.object({
      SUPABASE_URL: z.url(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    }).safeParse(process.env);
    if (!env.success) throw new FeedError('MISSING_OR_INVALID_SERVER_ENVIRONMENT');
    const dbUrl = new URL(env.data.SUPABASE_URL);
    if (dbUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(dbUrl.hostname)) {
      throw new FeedError('SUPABASE_REQUIRES_HTTPS');
    }
    const client = createClient(env.data.SUPABASE_URL, env.data.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
    });
    store = supabaseStore(client);
  }
  const results = await runFeeds(selected, store);
  if (results.some(result => result.status === 'failed' || result.status === 'partial')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'failed', error: error instanceof FeedError ? error.code : 'INVALID_CONFIGURATION' }));
    process.exitCode = 1;
  });
}
