-- 091 — transposition-aware "did you mean".
--
-- Plain Levenshtein charges 2 for a swapped pair, so MFST -> MSFT ranked
-- below every one-letter neighbour (MNST, LFST, BFST, SFST) and fell off a
-- four-item list entirely. Two symbols made of exactly the same letters are
-- almost always the same intended name, so score that case explicitly.
create or replace function public.sorted_chars(s text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select coalesce(string_agg(c, '' order by c), '')
  from regexp_split_to_table(upper(s), '') as c
  where c <> ''
$$;

grant execute on function public.sorted_chars(text) to anon, authenticated;
