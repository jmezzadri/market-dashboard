-- 092 — prominence-weighted "did you mean" (final scoring).
--
-- Pure string distance ranked PAPL (Pineapple Financial, micro-cap) above
-- AAPL for the typo APPL, because a letter scramble scores higher than a
-- one-letter edit. A suggestion list is a guess at intent, and intent
-- correlates with how well known the name is, so blend a bounded size term
-- (0 below ~$1B market cap, maxed at ~$3T) into the score.
--
-- Verified after this change: APPL -> AAPL, MFST -> MSFT, AMZM -> AMZN,
-- NVDIA -> NVDA, TSLAA -> TSLA, "apple" -> AAPL all rank first; ZZZZQ
-- returns nothing.
create or replace function public.ticker_did_you_mean(q text, lim int default 5)
returns table (ticker text, name text, market_cap numeric, score numeric)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with needle as (
    select upper(btrim(coalesce(q, ''))) as t,
           public.sorted_chars(upper(btrim(coalesce(q, '')))) as ts
  ),
  scored as (
    select r.ticker,
           r.name,
           r.market_cap,
           greatest(
             /* same letters, different order — a swapped pair or a scramble */
             case when public.sorted_chars(r.ticker) = n.ts then 0.90 else 0 end::numeric,
             /* one or two character edits away */
             1.0 - (levenshtein(r.ticker, n.t)::numeric
                    / greatest(length(n.t), length(r.ticker))::numeric),
             /* the company name reads like what was typed */
             coalesce(similarity(coalesce(r.name, ''), n.t)::numeric, 0)
           ) as base,
           /* bounded prominence: 0 below ~$1B, 0.25 at ~$3T and above */
           (0.25 * least(1.0, greatest(0.0,
              (log(10, greatest(coalesce(r.market_cap, 0), 1)) - 9.0) / 3.5
           )))::numeric as prom
    from public.ticker_reference r
    cross join needle n
    where n.t <> ''
      and length(n.t) between 1 and 12
      and (
        levenshtein(r.ticker, n.t) <= 2
        or public.sorted_chars(r.ticker) = n.ts
        or similarity(coalesce(r.name, ''), n.t) > 0.35
      )
  )
  select ticker, name, market_cap, round(base + prom, 4) as score
  from scored
  order by score desc, market_cap desc nulls last, ticker
  limit greatest(coalesce(lim, 5), 1);
$$;

grant execute on function public.ticker_did_you_mean(text, int) to anon, authenticated;
