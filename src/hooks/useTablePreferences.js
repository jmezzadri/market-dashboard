// useTablePreferences — per-user column prefs for every customizable table
// on the portopps page.
//
// Pattern
// -------
// One row per user in public.user_preferences.preferences (JSONB). The blob is
// keyed by a `tableKey` string — e.g. "positions", "watchlist_buy",
// "watchlist_near", "watchlist_other". Each entry is:
//   { order: ["colId", ...], visible: ["colId", ...], widths: { colId: px, ... } }
//
// The hook exposes:
//   {
//     prefs,            // { order, visible, widths } for THIS tableKey
//     setOrder(order),  // write new order
//     setVisible(vis),  // write new visibility set
//     setWidths(map),   // write new per-col width map
//     resetToDefaults(),// wipe user overrides for this table (keeps other tables)
//     loading,          // true during initial fetch
//     ready,            // true once we have prefs (from DB or defaults)
//   }
//
// Writes are debounced 500ms so drag-reorder / drag-resize don't hammer the DB.
//
// Forward-compat
// --------------
// defaultOrder / defaultVisible / defaultWidths are provided by the caller
// (callers should pass stable module-level references to avoid memo churn).
// When we add new columns to a table later, saved prefs are merged with
// defaults so any columns the user's saved state doesn't mention get
// appended to the end (hidden by default, default width) without disrupting
// the columns the user has already arranged.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

const SAVE_DEBOUNCE_MS = 500;
const MIN_WIDTH_PX = 48;
const MAX_WIDTH_PX = 2000;

// Module-level cache so switching tabs in the same session doesn't re-fetch
// the row every time a new table mounts. Keyed by user_id.
const prefsCache = new Map();

export function useTablePreferences(
  tableKey,
  { defaultOrder, defaultVisible, defaultWidths }
) {
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
  // auto-appending any newly-added columns.
  const prefs = useMemo(() => {
    const saved = (allPrefs && allPrefs[tableKey]) || {};
    const savedOrder   = Array.isArray(saved.order)   ? saved.order   : [];
    const savedVisible = Array.isArray(saved.visible) ? saved.visible : null;
    const savedWidths  = (saved.widths && typeof saved.widths === "object") ? saved.widths : {};

    const validIds = new Set(defaultOrder);

    // Order: start with saved, then append any defaults not already listed.
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

    // Visibility: if user never saved one, use defaultVisible.
    const visible = savedVisible
      ? savedVisible.filter((id) => validIds.has(id))
      : [...defaultVisible];

    // Widths: start with defaults, then overlay saved widths that are for
    // still-valid columns and within sane bounds. New columns inherit their
    // default width automatically.
    const widths = { ...(defaultWidths || {}) };
    for (const id of Object.keys(savedWidths)) {
      if (!validIds.has(id)) continue;
      const w = Number(savedWidths[id]);
      if (Number.isFinite(w) && w >= MIN_WIDTH_PX && w <= MAX_WIDTH_PX) {
        widths[id] = Math.round(w);
      }
    }

    return { order, visible, widths };
  }, [allPrefs, tableKey, defaultOrder, defaultVisible, defaultWidths]);

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

  const setWidths = useCallback((widths) => {
    // Sanitize before persisting: drop non-numeric, clamp out-of-range.
    const clean = {};
    for (const [id, raw] of Object.entries(widths || {})) {
      const w = Number(raw);
      if (Number.isFinite(w) && w >= MIN_WIDTH_PX && w <= MAX_WIDTH_PX) {
        clean[id] = Math.round(w);
      }
    }
    mutateSlice((slice) => ({ ...slice, widths: clean }));
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
    setWidths,
    resetToDefaults,
    loading,
    ready,
  };
}
