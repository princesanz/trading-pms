import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleSchema, articleUrl, dayLabel, eventSchema, shiftDay, SYNC_COLUMNS, tickerTags, TOPICS, wibDay, wibTime } from '../../src/lib/newsTerminal.ts';

test('WIB day boundaries are independent of the host timezone', () => {
  assert.equal(wibDay(new Date('2026-10-20T17:00:00Z')), '2026-10-21');
  assert.equal(wibTime('2026-10-20T17:05:00Z'), '00:05');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
  assert.match(dayLabel('2026-10-21'), /21 Oct 2026/);
});
test('outbound links reject active schemes and embedded credentials', () => {
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.com', '/relative']) assert.equal(articleUrl(unsafe), null);
  assert.equal(articleUrl('https://example.com/story?a=1'), 'https://example.com/story?a=1');
});
test('client sync projection never requests diagnostics or leases', () => {
  assert.deepEqual(SYNC_COLUMNS.split(','), ['source', 'last_attempt', 'last_success', 'status']);
  assert.deepEqual(tickerTags('BTC'), ['BTC', 'BTC-USD']);
  assert.deepEqual(tickerTags('XAU'), ['XAU']);
  assert.deepEqual(TOPICS.Rates, ['bonds', 'monetary_policy', 'rates']);
});
test('calendar accepts textual economic values and unknown impact; rejects invalid timestamps', () => {
  const row = { id: 'e270b7c6-6c56-4b1c-807b-0f87d158596a', title: 'Bank Holiday', currency: 'USD', impact: 'holiday', event_time: '2026-10-21T00:00:00+07:00', forecast: '1.2M', previous: null };
  assert.equal(eventSchema.parse(row).forecast, '1.2M');
  assert.equal(eventSchema.parse({ ...row, impact: 'unknown' }).impact, 'unknown');
  assert.equal(eventSchema.safeParse({ ...row, event_time: 'tomorrow' }).success, false);
});
test('undated news stays undated rather than inventing a publication timestamp', () => {
  const row = articleSchema.parse({ id: 'e270b7c6-6c56-4b1c-807b-0f87d158596a', source: 'yahoo', publisher: null, title: 'Company news', url: 'https://example.com', published_at: null, first_seen_at: '2026-10-21T00:00:00Z', tickers: ['NVDA'], topics: [] });
  assert.equal(row.published_at, null);
});
