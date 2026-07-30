-- 090 — "Did you mean?" resolver for unknown ticker symbols.
--
-- Why: /ticker/APPL (a typo for AAPL) rendered a full page shell with a
-- $0.00 price, an empty chart and an empty company overview, because the
-- ticker page never asked whether the symbol exists at all. The page now
-- shows an explicit not-found state, and this function supplies the
-- close-match suggestions on it.
--
-- Ranking: edit distance on the SYMBOL (catches APPL -> AAPL, MFST -> MSFT)
-- OR trigram similarity on the COMPANY NAME (catches "aple" -> Apple Inc.).
-- Ties break on market cap so the household name wins.
--
-- ticker_reference is ~13K rows, so the sequential levenshtein pass is a
-- few milliseconds; the trigram indexes serve the name-similarity half and
-- also speed up the header search box's existing ilike lookups.

create extension if not exists pg_trgm;
create extension if not exists fuzzystrmatch;

create index if not exists ticker_reference_ticker_trgm
  on public.ticker_reference using gin (ticker gin_trgm_ops);
create index if not exists ticker_reference_name_trgm
  on public.ticker_reference using gin (name gin_trgm_ops);

create or replace function public.ticker_did_you_mean(q text, lim int default 5)
returns table (ticker text, name text, market_cap numeric, score numeric)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with needle as (select upper(btrim(coalesce(q, ''))) as t)
  select r.ticker,
         r.name,
         r.market_cap,
         greatest(
           1.0 - (levenshtein(r.ticker, n.t)::numeric
                  / greatest(length(n.t), length(r.ticker))::numeric),
           coalesce(similarity(coalesce(r.name, ''), n.t)::numeric, 0)
         ) as score
  from public.ticker_reference r
  cross join needle n
  where n.t <> ''
    and length(n.t) between 1 and 12
    and (
      levenshtein(r.ticker, n.t) <= 2
      or similarity(coalesce(r.name, ''), n.t) > 0.35
    )
  order by score desc, r.market_cap desc nulls last, r.ticker
  limit greatest(coalesce(lim, 5), 1);
$$;

grant execute on function public.ticker_did_you_mean(text, int) to anon, authenticated;
