import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { hash } from './model.ts';

test('migration, atomic merge, leases, rollback, freshness and role boundaries', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
    `);
    await db.exec(await readFile(new URL('../../supabase/migrations/202610200001_news_terminal.sql', import.meta.url), 'utf8'));
    const claim = async (source: string) => {
      const result = await db.query<{ token: string | null }>('select public.news_claim_feed($1) token', [source]);
      return result.rows[0].token;
    };
    const finish = (source: string, token: string | null, rows: unknown[], fetched = rows.length, rejected = 0, error: string | null = null, retryAt: string | null = null) =>
      db.query<{ changed: number }>('select public.news_finish_feed($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz) changed',
        [source, token, JSON.stringify(rows), fetched, rejected, error, retryAt]);
    const row = {
      source_item_key: 'guid:one', publisher: 'Publisher', title: 'AI news',
      url: 'https://example.com/one', canonical_url: 'https://example.com/one',
      published_at: '2026-10-20T10:00:00Z', tickers: ['NVDA'], topics: ['technology'],
    };
    await db.exec('set role service_role');
    const token = await claim('yahoo:NVDA');
    assert.ok(token);
    assert.equal(await claim('yahoo:NVDA'), null);
    await finish('yahoo:NVDA', token, [row]);
    const before = (await db.query<{ first_seen_at: string }>('select first_seen_at from public.market_news')).rows[0];
    await finish('yahoo:MSFT', await claim('yahoo:MSFT'), [{ ...row, published_at: null, tickers: ['MSFT'], topics: ['earnings'] }]);
    const news = (await db.query<{ tickers: string[]; topics: string[]; published_at: string; first_seen_at: string }>('select * from public.market_news')).rows[0];
    assert.deepEqual(news.tickers, ['MSFT', 'NVDA']);
    assert.deepEqual(news.topics, ['earnings', 'technology']);
    assert.ok(news.published_at);
    assert.deepEqual(news.first_seen_at, before.first_seen_at);
    const repeat = await finish('yahoo:NVDA', await claim('yahoo:NVDA'), [row]);
    assert.equal(repeat.rows[0].changed, 0);
    await assert.rejects(finish('yahoo:NVDA', token, [row]), /lease/);

    // One invalid row rolls back all article changes and the sync completion.
    const rollbackToken = await claim('cnbc');
    await assert.rejects(finish('cnbc', rollbackToken, [row, { ...row, source_item_key: 'bad', title: null }]));
    assert.equal((await db.query<{ count: number }>("select count(*)::int count from public.market_news where source='cnbc'")).rows[0].count, 0);
    assert.equal((await db.query<{ status: string }>("select status from public.feed_sync_state where source='cnbc'")).rows[0].status, 'running');
    await finish('cnbc', rollbackToken, [], 0, 0, 'DATABASE_COMMIT_FAILED');

    const event = { event_key: hash('event-1'), title: 'GDP', currency: 'USD', impact: 'high',
      event_time: '2026-10-20T12:30:00Z', forecast: '3.4%', previous: '3.3%' };
    await finish('forexfactory', await claim('forexfactory'), [event]);
    await db.exec("update public.economic_events set actual='3.5%'");
    await finish('forexfactory', await claim('forexfactory'), [{ ...event, forecast: null }]);
    const economic = (await db.query<{ actual: string; forecast: string }>('select actual,forecast from public.economic_events')).rows[0];
    assert.equal(economic.actual, '3.5%');
    assert.equal(economic.forecast, '3.4%');
    await finish('forexfactory', await claim('forexfactory'), [{ ...event, event_key: hash('event-2'), event_time: '2026-10-20T13:00:00Z' }]);
    assert.equal((await db.query<{ needs_review: boolean }>('select needs_review from public.economic_events where event_key=$1', [hash('event-2')])).rows[0].needs_review, true);

    const previousSuccess = (await db.query<{ last_success: string }>("select last_success from public.feed_sync_state where source='yahoo:NVDA'")).rows[0].last_success;
    await finish('yahoo:NVDA', await claim('yahoo:NVDA'), [row], 2, 1);
    const partial = (await db.query<{ status: string; last_success: string }>("select status,last_success from public.feed_sync_state where source='yahoo:NVDA'")).rows[0];
    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.last_success, previousSuccess);
    await finish('marketwatch', await claim('marketwatch'), [], 0, 0, 'HTTP_429', '2099-01-01T00:00:00Z');
    assert.equal(await claim('marketwatch'), null);

    // Expired leases are fenced even before a replacement claims the feed.
    const expiredToken = await claim('cnbc');
    await db.exec("update public.feed_sync_state set lease_until=now()-interval '1 second' where source='cnbc'");
    await assert.rejects(finish('cnbc', expiredToken, []), /lease/);
    const replacement = await claim('cnbc');
    assert.notEqual(replacement, expiredToken);
    await assert.rejects(finish('cnbc', expiredToken, []), /lease/);
    await finish('cnbc', replacement, []);
    await assert.rejects(finish('cnbc', null, []), /lease/);

    await db.exec('reset role; set role authenticated');
    assert.ok((await db.query('select * from public.market_news')).rows.length);
    await db.query('select source,status,last_success from public.feed_sync_state');
    for (const sql of [
      'select * from public.feed_sync_state',
      'select error_message from public.feed_sync_state',
      "insert into public.market_news(source) values ('cnbc')",
      'update public.economic_events set actual=null',
      'delete from public.market_news',
      "select public.news_claim_feed('cnbc')",
      "select public.news_finish_feed('cnbc',gen_random_uuid(),'[]',0,0)",
    ]) await assert.rejects(db.exec(sql), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select * from public.market_news'), /permission denied/);
    await assert.rejects(db.exec('select * from public.economic_events'), /permission denied/);
    await assert.rejects(db.exec('select source from public.feed_sync_state'), /permission denied/);
    await assert.rejects(db.exec("select public.news_claim_feed('cnbc')"), /permission denied/);
  } finally { await db.close(); }
});
