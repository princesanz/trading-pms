import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseForexFactory, parseRss, parseYahoo } from './adapters.ts';
import { canonicalUrl, deduplicate, publicationTime } from './model.ts';
import { FeedError, fetchFeed, retryAfterMs } from './http.ts';
import { runFeeds, runFeed } from './worker.ts';
import type { Store } from './worker.ts';
import type { Feed, NewsRow } from './model.ts';

const article = (tickers = ['NVDA']) => ({
  uuid: 'article-1', title: 'AI earnings and Treasury yields', link: 'https://example.com/a?utm_source=yahoo&id=1',
  publisher: 'Publisher', providerPublishTime: 1792454400, relatedTickers: tickers,
});
test('calendar handles offsets, Holiday, unknown impact, null values and repeat identity', () => {
  const item = { title: ' GDP ', country: 'USD', date: '2026-10-20T08:30:00-04:00', impact: 'Holiday', forecast: '', previous: '3.4%' };
  const batch = parseForexFactory(JSON.stringify([item, item, { ...item, date: 'invalid' }]));
  assert.equal(batch.fetched, 3);
  assert.equal(batch.rejected, 1);
  assert.equal(batch.rows.length, 1);
  assert.equal('event_time' in batch.rows[0] && batch.rows[0].event_time, '2026-10-20T12:30:00.000Z');
  assert.equal('forecast' in batch.rows[0] && batch.rows[0].forecast, null);
  assert.equal('impact' in batch.rows[0] && batch.rows[0].impact, 'holiday');
  assert.equal('actual' in batch.rows[0], false);
  const other = parseForexFactory(JSON.stringify([{ ...item, impact: 'Unexpected' }]));
  assert.equal('impact' in other.rows[0] && other.rows[0].impact, 'unknown');
  assert.throws(() => parseForexFactory('[]'));
});
test('RSS parses single item, CDATA, entities and missing dates; rejects DTD and HTML', () => {
  const batch = parseRss('<rss><channel><title>Wire</title><item><title><![CDATA[Oil & gas]]></title><link>https://example.com/a?id=1&amp;utm_source=rss</link><guid isPermaLink="false">wire-1</guid></item></channel></rss>', 'Wire');
  const row = batch.rows[0] as NewsRow;
  assert.equal(row.title, 'Oil & gas');
  assert.equal(row.source_item_key, 'guid:wire-1');
  assert.equal(row.canonical_url, 'https://example.com/a?id=1');
  assert.equal(row.published_at, null);
  assert.deepEqual(row.topics, ['energy']);
  assert.throws(() => parseRss('<html>blocked</html>', 'Wire'));
  assert.throws(() => parseRss('<!DOCTYPE rss><rss/>', 'Wire'));
});
test('Yahoo merges duplicate tags and never invents relevance from query', () => {
  const batch = parseYahoo(JSON.stringify({ news: [article(), article(['MSFT']), { title: 42 }] }));
  assert.equal(batch.rejected, 1);
  assert.equal(batch.rows.length, 1);
  assert.deepEqual((batch.rows[0] as NewsRow).tickers, ['MSFT', 'NVDA']);
  const missingTags = parseYahoo(JSON.stringify({ news: [{ ...article(), relatedTickers: undefined }] }));
  assert.deepEqual((missingTags.rows[0] as NewsRow).tickers, []);
  assert.deepEqual(parseYahoo('{"news":[]}').rows, []);
  assert.throws(() => parseYahoo('{}'));
  assert.equal(deduplicate([...batch.rows, ...batch.rows]).length, 1);
});
test('URL normalization preserves identity parameters; timezone-less dates stay null', () => {
  assert.equal(canonicalUrl('https://EXAMPLE.com/A/?id=9&utm_medium=rss#section'), 'https://example.com/A/?id=9');
  assert.throws(() => canonicalUrl('javascript:alert(1)'));
  assert.throws(() => canonicalUrl('https://user:pass@example.com'));
  assert.equal(publicationTime('2026-10-20 08:00:00'), null);
  assert.equal(publicationTime('Tue, 20 Oct 2026 08:00:00 GMT'), '2026-10-20T08:00:00.000Z');
});
test('HTTP honors retry-after, does not retry permanent errors, caps payload', async () => {
  let calls = 0;
  const waits: number[] = [];
  const body = await fetchFeed('https://example.com', {
    fetcher: async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : new Response('ok'),
    wait: async ms => { waits.push(ms); },
  });
  assert.equal(body, 'ok');
  assert.deepEqual(waits, [2000]);
  await assert.rejects(fetchFeed('https://example.com', {
    fetcher: async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
  }), (err: unknown) => err instanceof FeedError && err.retryAt !== null && err.code.startsWith('RETRY_DEFERRED'));
  calls = 0;
  await assert.rejects(fetchFeed('https://example.com', {
    fetcher: async () => { calls++; return new Response('', { status: 403 }); },
  }), /HTTP_403/);
  assert.equal(calls, 1);
  await assert.rejects(fetchFeed('https://example.com', { maxBytes: 2, fetcher: async () => new Response('abc') }), /BODY_TOO_LARGE/);
  assert.equal(retryAfterMs('Tue, 20 Oct 2026 08:00:02 GMT', Date.parse('2026-10-20T08:00:00Z')), 2000);
});
test('network timeout retries are bounded', async () => {
  let calls = 0;
  await assert.rejects(fetchFeed('https://example.com', {
    fetcher: async () => { calls++; throw new DOMException('Timeout', 'TimeoutError'); },
    wait: async () => {},
  }), /NETWORK_OR_TIMEOUT/);
  assert.equal(calls, 3);
});
test('endpoint failure is isolated; lease contention skips network', async () => {
  const list: Feed[] = [
    { id: 'cnbc', url: 'https://example.com/bad', parse: parseYahoo },
    { id: 'yahoo:NVDA', url: 'https://example.com/good', parse: parseYahoo },
  ];
  const statuses: (string | undefined)[] = [];
  const store: Store = { claim: async () => 'lease', finish: async (_s, _t, _b, error) => { statuses.push(error); } };
  const results = await runFeeds(list, store, async url => url.endsWith('bad') ? '{}' : '{"news":[]}');
  assert.deepEqual(results.map(r => r.status), ['failed', 'success']);
  assert.deepEqual(statuses, ['INVALID_FEED_PAYLOAD', undefined]);
  const skipped = await runFeed(list[0], { ...store, claim: async () => null }, async () => { throw new Error('must not fetch'); });
  assert.equal(skipped.status, 'skipped');
});
