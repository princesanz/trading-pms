-- News & Macro Terminal, Phase 1. Run once through the migration runner.
-- Clients read domain data and safe sync columns. Only service_role executes writes.
begin;

create table public.economic_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source = 'forexfactory'),
  event_key text not null check (event_key ~ '^[0-9a-f]{64}$'),
  title text not null check (length(title) between 1 and 1000),
  currency text not null check (currency ~ '^([A-Z]{3}|ALL)$'),
  impact text not null check (impact in ('high','medium','low','holiday','unknown')),
  event_time timestamptz not null,
  forecast text,
  previous text,
  actual text,
  needs_review boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, event_key)
);

create table public.market_news (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('marketwatch','cnbc','yahoo')),
  source_item_key text not null check (length(source_item_key) between 1 and 2048),
  publisher text,
  title text not null check (length(title) between 1 and 1000),
  url text not null check (url ~ '^https?://' and length(url) <= 4096),
  canonical_url text not null check (canonical_url ~ '^https?://' and length(canonical_url) <= 4096),
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tickers text[] not null default '{}',
  topics text[] not null default '{}',
  unique (source, source_item_key),
  check (cardinality(tickers) <= 100),
  check (cardinality(topics) <= 30)
);

create table public.feed_sync_state (
  source text primary key check (source ~ '^(forexfactory|marketwatch|cnbc|yahoo:[A-Z0-9.^=-]{1,20})$'),
  last_attempt timestamptz,
  last_success timestamptz,
  last_changed_at timestamptz,
  status text not null default 'never_run'
    check (status in ('never_run','running','success','partial','failed')),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  written_count integer not null default 0 check (written_count >= 0),
  -- These columns are intentionally NOT granted to authenticated.
  error_message text,
  next_attempt_after timestamptz,
  lease_token uuid,
  lease_until timestamptz
);

create index economic_events_time_idx on public.economic_events (event_time, id);
create index economic_events_impact_time_idx on public.economic_events (impact, event_time);
create index economic_events_currency_time_idx on public.economic_events (currency, event_time);
create index market_news_time_idx on public.market_news (published_at desc nulls last, id desc);
create index market_news_seen_idx on public.market_news (first_seen_at desc, id desc);
create index market_news_tickers_idx on public.market_news using gin (tickers);
create index market_news_topics_idx on public.market_news using gin (topics);

alter table public.economic_events enable row level security;
alter table public.market_news enable row level security;
alter table public.feed_sync_state enable row level security;
revoke all on public.economic_events, public.market_news, public.feed_sync_state from public, anon, authenticated;
grant select on public.economic_events, public.market_news to authenticated;
grant select (source, last_attempt, last_success, last_changed_at, status,
  fetched_count, rejected_count, written_count) on public.feed_sync_state to authenticated;
grant all on public.economic_events, public.market_news, public.feed_sync_state to service_role;
create policy news_events_read on public.economic_events for select to authenticated using (true);
create policy news_articles_read on public.market_news for select to authenticated using (true);
create policy news_sync_read on public.feed_sync_state for select to authenticated using (true);

create function public.news_array_union(a text[], b text[])
returns text[] language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(v order by v), '{}'::text[])
  from (select distinct btrim(x) v from unnest(coalesce(a,'{}') || coalesce(b,'{}')) x
        where x is not null and btrim(x) <> '') s;
$$;

-- A bounded lease survives connection pooling. A crashed worker can be replaced
-- after five minutes; an expired worker cannot commit over a newer run.
create function public.news_claim_feed(p_source text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare token uuid := gen_random_uuid(); claimed uuid;
begin
  insert into public.feed_sync_state (source, last_attempt, status, lease_token, lease_until)
  values (p_source, clock_timestamp(), 'running', token, clock_timestamp() + interval '5 minutes')
  on conflict (source) do update set
    last_attempt = excluded.last_attempt, status = 'running',
    lease_token = excluded.lease_token, lease_until = excluded.lease_until,
    error_message = null
  where (public.feed_sync_state.lease_until is null
     or public.feed_sync_state.lease_until < clock_timestamp())
    and (public.feed_sync_state.next_attempt_after is null
     or public.feed_sync_state.next_attempt_after <= clock_timestamp())
  returning lease_token into claimed;
  return claimed;
end;
$$;

-- Domain writes and final sync state are ONE transaction. A failure cannot
-- advertise successful freshness for uncommitted data.
create function public.news_finish_feed(
  p_source text, p_token uuid, p_rows jsonb,
  p_fetched integer, p_rejected integer, p_error text default null,
  p_retry_at timestamptz default null
) returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s public.feed_sync_state%rowtype;
  r jsonb;
  changed integer := 0;
  affected integer;
  provider text := split_part(p_source, ':', 1);
begin
  select * into s from public.feed_sync_state where source = p_source for update;
  if not found or p_token is null or s.lease_token is null or s.lease_until is null
     or s.lease_token is distinct from p_token or s.lease_until < clock_timestamp() then
    raise exception 'Feed lease missing or expired';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) > 500
     or p_fetched is null or p_rejected is null
     or p_fetched < 0 or p_rejected < 0 or p_rejected > p_fetched
     or jsonb_array_length(p_rows) > p_fetched - p_rejected then
    raise exception 'Invalid batch';
  end if;
  if p_error is not null and jsonb_array_length(p_rows) <> 0 then
    raise exception 'Failed batches cannot write domain data';
  end if;
  for r in select value from jsonb_array_elements(p_rows) order by value->>'source_item_key', value->>'event_key'
  loop
    if provider = 'forexfactory' then
      insert into public.economic_events as e
        (source,event_key,title,currency,impact,event_time,forecast,previous,needs_review)
      values (provider,r->>'event_key',r->>'title',r->>'currency',r->>'impact',
        (r->>'event_time')::timestamptz,nullif(r->>'forecast',''),nullif(r->>'previous',''),
        exists (select 1 from public.economic_events old
          where old.source = provider and lower(old.title) = lower(r->>'title')
            and old.currency = r->>'currency' and old.event_key <> r->>'event_key'
            and abs(extract(epoch from (old.event_time - (r->>'event_time')::timestamptz))) < 604800))
      on conflict (source,event_key) do update set
        title = excluded.title, impact = excluded.impact,
        forecast = coalesce(excluded.forecast,e.forecast),
        previous = coalesce(excluded.previous,e.previous),
        updated_at = now()
      where (e.title,e.impact,e.forecast,e.previous) is distinct from
        (excluded.title,excluded.impact,coalesce(excluded.forecast,e.forecast),coalesce(excluded.previous,e.previous));
      -- actual is deliberately never populated or cleared by this feed.
    else
      insert into public.market_news as n
        (source,source_item_key,publisher,title,url,canonical_url,published_at,tickers,topics)
      values (provider,r->>'source_item_key',nullif(r->>'publisher',''),r->>'title',
        r->>'url',r->>'canonical_url',(r->>'published_at')::timestamptz,
        public.news_array_union('{}',array(select jsonb_array_elements_text(r->'tickers'))),
        public.news_array_union('{}',array(select jsonb_array_elements_text(r->'topics'))))
      on conflict (source,source_item_key) do update set
        publisher = coalesce(excluded.publisher,n.publisher), title = excluded.title,
        url = excluded.url, canonical_url = excluded.canonical_url,
        published_at = coalesce(excluded.published_at,n.published_at),
        tickers = public.news_array_union(n.tickers,excluded.tickers),
        topics = public.news_array_union(n.topics,excluded.topics), updated_at = now()
      where (n.publisher,n.title,n.url,n.canonical_url,n.published_at,n.tickers,n.topics) is distinct from
        (coalesce(excluded.publisher,n.publisher),excluded.title,excluded.url,excluded.canonical_url,
         coalesce(excluded.published_at,n.published_at),
         public.news_array_union(n.tickers,excluded.tickers),public.news_array_union(n.topics,excluded.topics));
    end if;
    get diagnostics affected = row_count;
    changed := changed + affected;
    if provider = 'forexfactory' then
      update public.economic_events set last_seen_at = now()
        where source = provider and event_key = r->>'event_key';
    else
      update public.market_news set last_seen_at = now()
        where source = provider and source_item_key = r->>'source_item_key';
    end if;
  end loop;
  update public.feed_sync_state set
    status = case when p_error is not null then 'failed' when p_rejected > 0 then 'partial' else 'success' end,
    last_success = case when p_error is null and p_rejected = 0 then now() else last_success end,
    last_changed_at = case when changed > 0 then now() else last_changed_at end,
    fetched_count = p_fetched, rejected_count = p_rejected,
    written_count = jsonb_array_length(p_rows),
    error_message = left(p_error,1000), next_attempt_after = p_retry_at,
    lease_token = null, lease_until = null
  where source = p_source;
  return changed;
end;
$$;

revoke all on function public.news_array_union(text[],text[]) from public, anon, authenticated;
revoke all on function public.news_claim_feed(text) from public, anon, authenticated;
revoke all on function public.news_finish_feed(text,uuid,jsonb,integer,integer,text,timestamptz) from public, anon, authenticated;
grant execute on function public.news_array_union(text[],text[]) to service_role;
grant execute on function public.news_claim_feed(text) to service_role;
grant execute on function public.news_finish_feed(text,uuid,jsonb,integer,integer,text,timestamptz) to service_role;

insert into public.feed_sync_state(source) values
  ('forexfactory'),('marketwatch'),('cnbc'),
  ('yahoo:AAPL'),('yahoo:MSFT'),('yahoo:NVDA'),('yahoo:TSLA'),('yahoo:META');
commit;
