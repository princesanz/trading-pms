# News Terminal

`/news` is a global authenticated research page alongside Overview. It uses the existing Supabase browser client and the existing `adm` theme. It does not run ingestion or require a service key in Vite.

## Contract

- `economic_events`: `id,title,currency,impact,event_time,forecast,previous`. Actuals are intentionally neither queried nor displayed. Calendar dates and times use Asia/Jakarta, independent of the browser timezone. A selected day is a date group; previous/next and the date picker navigate groups. At most 100 events are displayed per day, with an explicit truncation notice if more are returned.
- `market_news`: `id,source,publisher,title,url,published_at,first_seen_at,tickers,topics`. Articles are ordered by publication timestamp descending, nulls last, then ID. Unknown publication times remain explicitly unknown. Fifty articles per page; one extra row detects the next page.
- `feed_sync_state`: only `source,last_attempt,last_success,status`. No diagnostic, scheduling or lease columns are requested. Status belongs to each endpoint, never an aggregate that conceals failures. Thirty minutes is a UI age indicator, not a provider SLA.
- Macro sources are `marketwatch` and `cnbc`. Topic filters use stored tags: Energy = energy; Rates = bonds/monetary_policy/rates; Equities = equities/earnings; Geopolitics = geopolitics. Existing ingestion rules may only populate the earnings subset of Equities. Filters cannot infer untagged stories.
- Watchlist filters use stored article tickers across publishers. BTC also matches BTC-USD. XAU is not silently mapped to a miners index or futures contract. Default ingestion only configures the five technology stocks; XAU/BTC can therefore be empty and show missing endpoint coverage.

## Fetching and security

Queries mount only after authentication and are scoped to the user ID. Sign-out cancels news requests and removes the news cache through the existing AuthProvider. Unmounting aborts unused requests; inactive cache entries expire after five minutes. Existing RLS remains the authorization boundary. Requests have a 15-second timeout and one retry. Active queries refresh every minute while visible. Headline snapshots exclude newly ingested rows during pagination; Latest starts a new snapshot. Corrections to existing rows may still change order between page requests.

External links allow HTTP/HTTPS only, reject embedded credentials, and open with `noopener noreferrer`. React escapes all feed text; no article HTML is rendered.

## UI

The existing typography and graphite surfaces are reused. News colors are centralized in `src/design/tokens.ts`: gold calendar, cyan macro, violet watchlist, amber energy, blue rates and pink geopolitics. Feed status uses green for success, amber for stale/partial and red for failures; impact badges use red/high, amber/medium, green/low and violet/holiday. Text labels remain the primary meaning. Scoped `NewsTerminal.css` applies the palette without changing other desks. Fixed-height status, controls, content viewport and footer reserve layout space across loading, success, empty and error states. The calendar scrolls inside its panel on narrow screens. Tabs support arrows, Home and End with visible focus. Transitions only affect colors and honor reduced motion. Panel geometry is checked by the browser test; this is not a claim that all application-level CLS has been measured as zero.

## Validation

```sh
npm run build
npm run dev
node --import tsx --test scripts/news/frontend.test.ts
```

`scripts/news/frontend-browser.mjs` runs isolated Playwright checks against a local Vite server. It intercepts every external request, uses synthetic authentication, and never writes to Supabase. It requires Playwright on Node's module path and installed Edge (or `NEWS_TEST_BROWSER` for another installed channel). `NEWS_TEST_ORIGIN` defaults to http://127.0.0.1:5178. Screenshots are saved to the OS temporary directory under `trading-pms-news-ui`.
