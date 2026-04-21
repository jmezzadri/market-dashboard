// useTablePreferences — per-user column prefs (order + visibility) for every
// customizable table on the portopps page.
//
// Pattern
// -------
// One row per user in public.user_preferences.preferences (JSONB). The blob is
// keyed by a `tableKey` string — e.g. "positions", "watchlist_buy",
// "watchlist_near", "watchlist_other". Each entry is:
//   { order: ["colId", ...], visible: ["colId", ...] }
//
// The hook exposes:
//   {
//     prefs,            // { order, visible } for THIS tableKey, merged w/ defaults
//     setOrder(order),  // write new order
//     setVisible(vis),  // write new visibility set
//     resetToDefaults(),// wipe user overrides for this table (keeps other tables)
//     loading,          // true during initial fetch
//     ready,            // true once we have prefs (from DB or defaults)
//   }
//
// Writes are debounced 500ms so drag-reorder doesn't hammer the DB.
//
// Forward-compat
// --------------
// defaultOrder / defaultVisible are provided by the caller. When we add new
// columns to a table later, we merge user-saved arrays with defaults so any
// columns the user's saved state doesn't mention get appended to the end
// (still hidden by default until the user toggles them on in the picker).
// That means existing users pick up new columns automatically without being
// stuck on a frozen layout.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

const SAVE_DEBOUNCE_MS = 500;

// Module-level cache so switching tabs in the same session doesn't re-fetch
// the row every time a new table mounts. Keyed by user_id.
const prefsCache = new Map();

export function useTablePreferences(tableKey, { defaultOrder, defaultVisible }) {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;

  // Full blob for this user across ALL tables. We only expose this table's
  // slice via `prefs`, but we need the whole thing on save so we don't wipe
  // other tables' settings.
  const [allPrefs, setAllPrefs] = useState(() =>
    userId ? prefsCache.get(userId) ?? null : null
  );
  const [loading, setLoading] = useState(false);
  const [ready,   setReady]   = useState(false);

  // Fetch on sign-in / user-swap. Anon users just get defaults — no DB call.
  useEffect(() => {
    if (!userId) {
      setAllPrefs(null);
      setReady(true);
      return;
    }
    // Cache hit — skip round trip.
    if (prefsCache.has(userId)) {
      setAllPrefs(prefsCache.get(userId));
      setReady(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("user_preferences")
          .select("preferences")
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled) return;
        if (error && error.code !== "PGRST116") {
          // PGRST116 = no row, which is fine for first-time users.
          // eslint-disable-next-line no-console
          console.warn("[useTablePreferences] load failed:", error);
        }
        const blob = data?.preferences || {};
        prefsCache.set(userId, blob);
        setAllPrefs(blob);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useTablePreferences] load threw:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Merge saved slice with defaults — preserves user's explicit choices while
  // auto-appending any newly-added columns. `visible` is a whitelist — a col
  // the user has never touched defaults to whatever defaultVisible says.
  const prefs = useMemo(() => {
    const saved = (allPrefs && allPrefs[tableKey]) || {};
    const savedOrder = Array.isArray(saved.order) ? saved.order : [];
    const savedVisible = Array.isArray(saved.visible) ? saved.visible : null;

    // Order: start with saved, then append any defaults not already listed
    // (new columns). Drop any saved ids that are no longer valid (removed cols).
    const validIds = new Set(defaultOrder);
    const order = [];
    const seen = new Set();
    for (const id of savedOrder) {
      if (validIds.has(id) && !seen.has(id)) {
        order.push(id);
        seen.add(id);
      }
    }
    for (const id of defaultOrder) {
      if (!seen.has(id)) {
        order.push(id);
        seen.add(id);
      }
    }

    // Visibility: if user never saved one, use defaultVisible. Otherwise use
    // saved — including for newly added columns (hidden by default until user
    // toggles them in the picker).
    const visible = savedVisible
      ? savedVisible.filter((id) => validIds.has(id))
      : [...defaultVisible];

    return { order, visible };
  }, [allPrefs, tableKey, defaultOrder, defaultVisible]);

  // Debounced persistence
  const saveTimer = useRef(null);
  const pendingWrite = useRef(null);

  const schedulePersist = useCallback((nextBlob) => {
    if (!userId) return;
    pendingWrite.current = nextBlob;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const blob = pendingWrite.current;
      pendingWrite.current = null;
      try {
        const { error } = await supabase
          .from("user_preferences")
          .upsert(
            { user_id: userId, preferences: blob },
            { onConflict: "user_id" }
          );
        if (error) {
          // eslint-disable-next-line no-console
          console.warn("[useTablePreferences] save failed:", error);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useTablePreferences] save threw:", err);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [userId]);

  const mutateSlice = useCallback((sliceUpdater) => {
    setAllPrefs((prev) => {
      const base = prev || {};
      const prevSlice = base[tableKey] || {};
      const nextSlice = sliceUpdater(prevSlice);
      const nextBlob = { ...base, [tableKey]: nextSlice };
      prefsCache.set(userId, nextBlob);
      schedulePersist(nextBlob);
      return nextBlob;
    });
  }, [tableKey, userId, schedulePersist]);

  const setOrder = useCallback((order) => {
    mutateSlice((slice) => ({ ...slice, order }));
  }, [mutateSlice]);

  const setVisible = useCallback((visible) => {
    mutateSlice((slice) => ({ ...slice, visible }));
  }, [mutateSlice]);

  const resetToDefaults = useCallback(() => {
    setAllPrefs((prev) => {
      if (!prev) return prev;
      const { [tableKey]: _, ...rest } = prev;
      prefsCache.set(userId, rest);
      schedulePersist(rest);
      return rest;
    });
  }, [tableKey, userId, schedulePersist]);

  return {
    prefs,
    setOrder,
    setVisible,
    resetToDefaults,
    loading,
    ready,
  };
}
