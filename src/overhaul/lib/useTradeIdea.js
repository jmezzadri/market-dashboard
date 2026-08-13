/* useTradeIdea — the Trade Idea tile on Home.

   Reads /trade_ideas.json, newest first. Published twice a week (Sunday and
   Wednesday) by the scheduled Cowork session per
   scripts/trade_idea_playbook.md, validated through
   scripts/build_trade_idea.py --prepare-file and committed by the same
   agent-write / ops-code-commit path the daily brief uses. Same accuracy
   contract as the brief (LESSONS 4.21): every figure is sourced-or-omitted
   and carries its own as-of date.

   The tile shows the current idea; `archive` holds the rest for the full
   note view. An idea stays live on the tile until the next one publishes —
   it is a position, not a headline, so it does not go stale at midnight. */

import { useEffect, useMemo, useState } from 'react';

export default function useTradeIdea() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/trade_ideas.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const ideas = useMemo(() => {
    const list = Array.isArray(data?.ideas) ? [...data.ideas] : [];
    return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [data]);

  return {
    idea: ideas[0] || null,
    archive: ideas.slice(1),
    nextPublish: data?.next_publish || null,
    loading,
  };
}

/* Publication cadence, stated in one place so the tile's empty state and the
   playbook cannot drift: Sunday and Wednesday evenings, US Eastern. */
export function nextPublishISO(fromISO) {
  const d = new Date(`${fromISO}T00:00:00Z`);
  for (let i = 1; i <= 7; i += 1) {
    const n = new Date(d);
    n.setUTCDate(d.getUTCDate() + i);
    const dow = n.getUTCDay(); // 0 Sun, 3 Wed
    if (dow === 0 || dow === 3) return n.toISOString().slice(0, 10);
  }
  return null;
}
