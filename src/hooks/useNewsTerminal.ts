import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { ARTICLE_COLUMNS, EVENT_COLUMNS, SYNC_COLUMNS, articleSchema, eventSchema, syncSchema, TOPICS, WATCHLIST, PAGE_SIZE, shiftDay, tickerTags, type Topic, type Article } from '../lib/newsTerminal';

const policy = {
  staleTime: 30_000, gcTime: 300_000, retry: 1,
  refetchInterval: 60_000, refetchIntervalInBackground: false,
  refetchOnWindowFocus: true, refetchOnReconnect: true,
} as const;
function requestSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
}
export function useFeedSync(userId: string) {
  return useQuery({
    ...policy, queryKey: ['news', userId, 'sync'],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('feed_sync_state').select(SYNC_COLUMNS).order('source').limit(100).abortSignal(requestSignal(signal));
      if (error) throw new Error('Feed status could not be loaded.');
      return z.array(syncSchema).parse(data);
    },
  });
}
export function useEconomicCalendar(userId: string, day: string) {
  return useQuery({
    ...policy, queryKey: ['news', userId, 'calendar', day],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('economic_events').select(EVENT_COLUMNS)
        .gte('event_time', `${day}T00:00:00+07:00`).lt('event_time', `${shiftDay(day, 1)}T00:00:00+07:00`)
        .order('event_time').order('id').limit(101).abortSignal(requestSignal(signal));
      if (error) throw new Error('Economic calendar could not be loaded. Check your connection and session.');
      return z.array(eventSchema).parse(data);
    },
  });
}
export function useHeadlines(userId: string, mode: 'macro' | 'watchlist', topic: Topic, ticker: string, page: number, snapshot: string) {
  return useQuery<Article[]>({
    ...policy, refetchInterval: page === 0 ? 60_000 : false,
    queryKey: ['news', userId, mode, topic, ticker, page, snapshot],
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      return key?.[1] === userId && key[2] === mode && key[3] === topic && key[4] === ticker && key[5] === page ? previous : undefined;
    },
    queryFn: async ({ signal }) => {
      let query = supabase.from('market_news').select(ARTICLE_COLUMNS)
        .lte('first_seen_at', snapshot).order('published_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false });
      if (mode === 'macro') {
        query = query.in('source', ['marketwatch', 'cnbc']);
        if (topic !== 'All') query = query.overlaps('topics', TOPICS[topic]);
      } else {
        query = query.overlaps('tickers', ticker === 'All' ? [...WATCHLIST, 'BTC-USD'] : tickerTags(ticker));
      }
      const { data, error } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).abortSignal(requestSignal(signal));
      if (error) throw new Error('Headlines could not be loaded. Check your connection and session.');
      return z.array(articleSchema).parse(data);
    },
  });
}
