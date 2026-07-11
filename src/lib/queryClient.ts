/**
 * Shared react-query client (admin redesign).
 *
 * Journal / track-record data changes ONLY when Sanz writes a trade or a cash
 * flow, so queries are cached forever (staleTime: Infinity) and invalidated
 * PRECISELY by table-scoped keys at the mutation sites — never by focus or
 * interval refetches. Query keys are one-per-table; desk-filtered reads add
 * the desk as a second element (e.g. ['cash_flows', 'Crypto']).
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      // gcTime: Infinity is DELIBERATE and paired with staleTime: Infinity — do not
      // revert to the 5-min default. Otherwise an inactive query (e.g. ['trades'])
      // is GC'd after 5 min away and refetches on remount with nothing invalidated,
      // contradicting the "cached until an explicit write invalidates it" intent.
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});
