// useCommentary — reads threshold-gated editorial commentary for the
// Home page's Macro Overview and Sector Outlook tiles.
//
// Why
// ---
// Joe's feedback on the Phase 3 Home redesign: he wants a sentence or two
// tying notable indicator / sector moves to real current events, BUT he
// rejects forced AI narrative. The engine that feeds this hook
// (supabase/functions/generate-commentary) runs nightly, detects
// meaningful moves (indicator ≥1 SD over 1–5d short-term / ≥1.5 SD over
// 20+d medium-term; sector rank Δ ≥3 positions or bucket change),
// queries market headlines, and writes a short plain-English tie-in OR
// writes null when nothing material happened. The hook just reads the
// latest row; renderers check for null and skip.
//
// Shape returned
// --------------
//   {
//     macro : {
//       short_term : string | null,       // ~25 words max
//       medium_term: string | null,       // ~25 words max
//       generated_at: ISO | null
//     } | null,
//     sector: {
//       headline: string | null,          // single-sentence summary, null if nothing
//       generated_at: ISO | null
//     } | null,
//     loading: boolean,
//     error  : Error | null
//   }
//
// Both tables RLS-read: anon (public). Engine writes with service role.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useCommentary(){
  const [macro, setMacro]   = useState(null);
  const [sector, setSector] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Latest macro commentary (one row per day).
        const { data: m, error: mErr } = await supabase
          .from("macro_commentary")
          .select("short_term, medium_term, generated_at")
          .order("generated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mErr && mErr.code !== "PGRST116") throw mErr;
        // Latest sector commentary (one row per day).
        const { data: s, error: sErr } = await supabase
          .from("sector_commentary")
          .select("headline, generated_at")
          .order("generated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (sErr && sErr.code !== "PGRST116") throw sErr;
        if (cancelled) return;
        setMacro(m || null);
        setSector(s || null);
      } catch (e) {
        if (!cancelled) setError(e);
        // Soft-fail: if tables don't exist yet (pre-migration), just
        // render nothing in the editorial slots. The tile renderers
        // null-check this shape already.
        if (!cancelled) { setMacro(null); setSector(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { macro, sector, loading, error };
}
