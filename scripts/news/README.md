# News & Macro ingestion

Phase 1 backend for the global `/news` page. Requires Node.js 22.12+ and the
repository dependencies (`npm ci`, including dev dependencies for the TS runner).
The frontend is documented in `src/pages/NewsTerminal.README.md`.
For the cloud scheduler, follow [the GitHub Actions activation guide](GITHUB-ACTIONS.md).

## Apply the database migration

Run `supabase/migrations/202610200001_news_terminal.sql` once against the intended
Supabase project using its SQL Editor or your existing migration runner. It is
transactional and creates only the news feature's tables, indexes and functions.
It deliberately fails if these objects already exist; do not rerun it as an
upgrade script. Existing portfolio tables and policies are not changed.

Roles `anon`, `authenticated` and `service_role` are the standard Supabase roles.
Authenticated users can read news and events. Anonymous users have no access.
Only the service role can mutate data or call the ingestion RPCs. The service
role also retains SELECT, which PostgreSQL upsert/locking and operations require;
"service-only writes" does not mean removing the service role's read access.
Any authenticated account can read these shared feeds. No portfolio data is
joined or exposed.

## Run

Inject these real secrets through your server's environment/secret manager:

| Variable | Requirement |
| --- | --- |
| `SUPABASE_URL` | Required for writes; project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for writes; server-only service credential |
| `NEWS_TICKERS` | Optional comma-separated symbols; defaults to AAPL,MSFT,NVDA,TSLA,META |

Never use `VITE_` for the service credential. The worker does not automatically
load the frontend `.env` or print configuration values.

```sh
npm run news:check
npm run news:test
npm run news:dry-run
npm run news:ingest
node node_modules/tsx/dist/cli.mjs scripts/news/worker.ts --source=forexfactory
node node_modules/tsx/dist/cli.mjs scripts/news/worker.ts --source=yahoo:NVDA
```

Dry-run fetches, validates and deduplicates without requiring Supabase secrets or
writing to the database. `written: 0` is intentional in dry-run.
The dedicated `news:dry-run` script keeps the flag inside the command, avoiding
argument forwarding differences in npm/PowerShell wrappers.

Run this as a one-shot server job using the deployment platform's scheduler.
Schedule individual endpoints with `--source` if they need different cadences.
Choose intervals based on provider usage limits and observed freshness; the code
does not claim a real-time SLA. Configure the runtime for at least 30 minutes for
the default eight endpoints at their worst-case timeout/retry duration, or run
individual endpoints with a five-minute job timeout. Endpoints run serially.
A per-endpoint database lease expires after five minutes and prevents overlapping
commits. No database connection is held during HTTP requests.

Exit code 1 means at least one failed or partial endpoint. Exit code 0 means all
selected endpoints succeeded or were skipped due to an active lease/cooldown.
Alert on failures AND stale `last_success`, not the process exit code alone.
An abruptly terminated job may remain `running`; an expired lease permits recovery
on the next invocation. A database outage can leave the final state unconfirmed.

## Data and identity contracts

- Calendar key: SHA-256 of a JSON tuple containing provider, normalized title,
  currency, and UTC event time. This is a polling deduplication key, not a provider
  event ID. A rescheduled event produces a new row. A same-title/currency event
  within seven days marks the new row `needs_review`; this is a heuristic that can
  also flag legitimate recurring events. Both rows remain until reconciled.
- Calendar empty arrays are rejected to avoid falsely reporting a healthy
  calendar on an unexpected empty response. Impact supports high/medium/low/
  holiday/unknown. ALL is a currency sentinel for global events.
- Forecast and previous retain source text, including units. Empty values do
  not erase existing nonempty values. This favors preservation over propagating
  a possible source withdrawal, which requires reconciliation. Actual is nullable
  and never written by this adapter.
- News identity is `(source, source_item_key)`: GUID when present, otherwise a
  SHA-256 canonical URL key. A source changing from no GUID to GUID can create
  another row; cross-provider syndication is not merged.
- Canonicalization removes only a small known tracking parameter list and the
  fragment, preserving semantic query parameters. URLs are links, never fetched
  by the worker.
- Yahoo source is `yahoo` for shared article identity; sync state is per ticker,
  such as `yahoo:NVDA`. Only provider `relatedTickers` become tags. Articles without
  these tags remain untagged even if returned by a ticker query.
- News dates can be null. Do not replace a missing publication time with ingestion
  time. Display "Publication time unavailable", or explicitly sort by first seen.
- Topic tags use deterministic English title keywords; they are approximate,
  multi-label metadata, not investment signals. No earnings dataset is implied.
- SQL conflict updates atomically union distinct tickers/topics and preserve
  `first_seen_at`. Nonempty scalar metadata follows the latest successful ingest.
  Arrays are additive; incorrect upstream tags need explicit correction.
- A whole endpoint batch (at most 500 input items / 2 MB HTTP body) commits with
  its final sync state in one transaction. Over-limit feeds fail instead of being
  silently truncated. Invalid items are counted; valid items still commit.
- `last_success` advances only for fully valid batches; `partial` retains the old
  value. `last_changed_at` excludes mere sightings of unchanged data.
  `written_count` is distinct valid rows processed, not rows whose content changed.
- HTTP requests have 15-second timeouts and at most three attempts. Retryable
  responses are 408/429/500/502/503/504. Retry-After up to 30 seconds is honored
  inline; longer delays are persisted and respected by future claims.
- No retention deletion is automatic. Preserve older calendar weeks and plan a
  separate archival policy when storage growth justifies it.

## Frontend read contract

Query domain tables with explicit columns and bounded date ranges/pages. Use
`(published_at, id)` cursor ordering for dated news; handle undated news separately
or order all news explicitly by `(first_seen_at, id)`. Ticker/topic filters can use
array overlap/containment and the provided GIN indexes.

The sync table intentionally has column-level SELECT grants. This works:

```ts
const { data, error } = await supabase
  .from('feed_sync_state')
  .select('source,status,last_attempt,last_success,last_changed_at,fetched_count,rejected_count,written_count');
```

`select('*')` fails because error text, lease tokens and cooldown internals are
not client-readable. Show freshness per endpoint and separately show the age of
the newest article/event coverage. A successful poll is not proof the publisher
has refreshed its content. Render titles as plain React text; never inject RSS
HTML. Open external links with `rel="noopener noreferrer"`.

## Verification

`news:test` runs adapter/HTTP/worker tests plus a real PostgreSQL WASM instance
(PGlite) applying the exact migration. It checks roles, hidden sync columns,
array merges, retries, transaction rollback, missing data, changed event times,
lease fencing and cooldowns. It does not replace a staging Supabase/PostgREST
smoke test. Production SQL and scheduled writes must be applied separately.

Validation on 2026-10-20: all eight local tests passed. A live, read-only run
parsed 86 ForexFactory events, 10 MarketWatch headlines, 30 CNBC headlines and
19/18/19/20/19 Yahoo items for AAPL/MSFT/NVDA/TSLA/META respectively, with zero
rejected items. These are observations from one run, not availability guarantees.
