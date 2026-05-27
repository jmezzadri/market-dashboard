/* TweaksContext — persisted theme/accent/density/sidebar/fonts/typeScale.
   Per site-overhaul brief baked-in decisions:
     - First visit defaults to Light.
     - Persists in localStorage under the keys below.
     - Same for accent ("blue"), density ("balanced"), sidebar ("rail"),
       fonts ("fraunces-inter"), typeScale ("editorial").
   Apply tokens by setting data-mt-* attributes on <html>.

   The full Tweaks panel UI lands in PR-O10; this context is the
   foundation for it (and the gear button in PageHeader). */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';

const DEFAULTS = {
  theme: 'light',
  accent: 'blue',
  density: 'balanced',
  sidebar: 'rail',
  fonts: 'fraunces-inter',
  typeScale: 'editorial',
};

const STORAGE_PREFIX = 'mt.overhaul.';

function readPersisted(key) {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function writePersisted(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // Quota / private mode — non-fatal.
  }
}

function loadInitial() {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = readPersisted(k);
    if (v != null) out[k] = v;
  }
  return out;
}

const TweaksCtx = createContext(null);

export function TweaksProvider({ children }) {
  const [tweaks, setTweaks] = useState(loadInitial);
  const [panelOpen, setPanelOpen] = useState(false);

  const setTweak = useCallback((key, value) => {
    setTweaks((prev) => {
      const next = { ...prev, [key]: value };
      writePersisted(key, value);
      return next;
    });
  }, []);

  const resetTweaks = useCallback(() => {
    for (const k of Object.keys(DEFAULTS)) writePersisted(k, DEFAULTS[k]);
    setTweaks({ ...DEFAULTS });
  }, []);

  // Sync tweaks → <html data-mt-*> attributes whenever they change.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-mt-theme', tweaks.theme);
    root.setAttribute('data-mt-accent', tweaks.accent);
    root.setAttribute('data-mt-density', tweaks.density);
    root.setAttribute('data-mt-sidebar', tweaks.sidebar);
    root.setAttribute('data-mt-fonts', tweaks.fonts);
    root.setAttribute('data-mt-type', tweaks.typeScale);
    return () => {
      // On unmount (e.g., user toggles the overhaul off), strip the
      // data-attrs so legacy CSS isn't accidentally re-themed by them.
      root.removeAttribute('data-mt-theme');
      root.removeAttribute('data-mt-accent');
      root.removeAttribute('data-mt-density');
      root.removeAttribute('data-mt-sidebar');
      root.removeAttribute('data-mt-fonts');
      root.removeAttribute('data-mt-type');
    };
  }, [tweaks.theme, tweaks.accent, tweaks.density, tweaks.sidebar, tweaks.fonts, tweaks.typeScale]);

  const value = useMemo(
    () => ({
      tweaks,
      setTweak,
      resetTweaks,
      panelOpen,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      togglePanel: () => setPanelOpen((p) => !p),
    }),
    [tweaks, setTweak, resetTweaks, panelOpen],
  );

  return <TweaksCtx.Provider value={value}>{children}</TweaksCtx.Provider>;
}

export function useTweaks() {
  const ctx = useContext(TweaksCtx);
  if (!ctx) {
    throw new Error('useTweaks must be used inside <TweaksProvider>');
  }
  return ctx;
}
