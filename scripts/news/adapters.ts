import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import {
  canonicalUrl, eventSchema, hash, newsSchema, parseItems,
  publicationTime, text, topicsFor,
} from './model.ts';
import type { Batch, Feed } from './model.ts';

const ffItem = z.object({
  title: text, country: text, date: z.iso.datetime({ offset: true }),
  impact: z.string(), forecast: z.string().nullish(), previous: z.string().nullish(),
});
export function parseForexFactory(body: string): Batch {
  const items = z.array(z.unknown()).min(1).parse(JSON.parse(body));
  return parseItems(items, raw => {
    const item = ffItem.parse(raw);
    const title = item.title.normalize('NFKC').replace(/\s+/g, ' ');
    const currency = item.country.toUpperCase();
    const eventTime = new Date(item.date).toISOString();
    const impact = item.impact.trim().toLowerCase();
    return eventSchema.parse({
      event_key: hash(JSON.stringify(['forexfactory', title.toLowerCase(), currency, eventTime])),
      title, currency,
      impact: ['high', 'medium', 'low', 'holiday'].includes(impact) ? impact : impact === 'med' ? 'medium' : 'unknown',
      event_time: eventTime, forecast: item.forecast, previous: item.previous,
    });
  });
}

const rssItem = z.object({
  title: text, link: z.string(), guid: z.union([z.string(), z.object({ '#text': z.string() })]).optional(),
  pubDate: z.string().optional(),
});
const rssEnvelope = z.object({
  rss: z.object({ channel: z.object({ title: text, item: z.array(z.unknown()).optional() }) }),
});
export function parseRss(body: string, publisher: string): Batch {
  // No external entities, DTDs, or custom entity expansion.
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error('Unsupported XML declaration');
  if (XMLValidator.validate(body) !== true) throw new Error('Malformed RSS XML');
  const parser = new XMLParser({
    ignoreAttributes: true, parseTagValue: false, trimValues: true,
    isArray: (_name, path) => path === 'rss.channel.item',
  });
  const channel = rssEnvelope.parse(parser.parse(body)).rss.channel;
  return parseItems(channel.item ?? [], raw => {
    const item = rssItem.parse(raw);
    const canonical = canonicalUrl(item.link);
    const guid = typeof item.guid === 'string' ? item.guid : item.guid?.['#text'];
    return newsSchema.parse({
      source_item_key: guid?.trim() ? `guid:${guid.trim()}` : `url:${hash(canonical)}`,
      publisher, title: item.title, url: item.link, canonical_url: canonical,
      published_at: publicationTime(item.pubDate), tickers: [], topics: topicsFor(item.title),
    });
  });
}

const yahooItem = z.object({
  uuid: z.string().optional(), title: text, link: z.string(),
  publisher: z.string().nullish(),
  providerPublishTime: z.number().finite().positive().optional(),
  relatedTickers: z.array(z.string()).optional(),
});
export function parseYahoo(body: string): Batch {
  // Missing news is schema failure, not a healthy empty feed.
  const payload = z.object({ news: z.array(z.unknown()) }).parse(JSON.parse(body));
  return parseItems(payload.news, raw => {
    const item = yahooItem.parse(raw);
    const canonical = canonicalUrl(item.link);
    return newsSchema.parse({
      source_item_key: item.uuid?.trim() ? `guid:${item.uuid.trim()}` : `url:${hash(canonical)}`,
      publisher: item.publisher, title: item.title, url: item.link, canonical_url: canonical,
      published_at: publicationTime(item.providerPublishTime),
      // A query match alone is not evidence the article concerns the queried ticker.
      tickers: [...new Set((item.relatedTickers ?? []).map(t => t.toUpperCase())
        .filter(t => /^[A-Z0-9.^=-]{1,20}$/.test(t)))],
      topics: topicsFor(item.title),
    });
  });
}

export function feeds(tickers: string[]): Feed[] {
  return [
    { id: 'forexfactory', url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', parse: parseForexFactory },
    { id: 'marketwatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
      parse: body => parseRss(body, 'MarketWatch') },
    { id: 'cnbc', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html',
      parse: body => parseRss(body, 'CNBC') },
    ...tickers.map(ticker => ({
      id: `yahoo:${ticker}`,
      url: `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=0&newsCount=20`,
      parse: parseYahoo,
    })),
  ];
}
