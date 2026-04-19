// Supabase client singleton. Reads Vite env vars baked at build time.
//
// Set the following in `.env` (local) and in Vercel → Project → Settings → Environment Variables (prod):
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY   (the new "publishable" key — `sb_publishable_...`)
//
// The publishable/anon key is safe to ship to the browser when Row-Level Security
// is enabled on every user-owned table. We rely on RLS (see TRACK_B_MULTIUSER_SCOPE.md)
// to enforce data isolation; the key itself only lets the client reach the PostgREST
// endpoint. Never ship the `sb_secret_...` (service role) key to the browser.

import { createClient } from "@supabase/supabase-js";

const url  = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail loudly in dev if env vars are missing. In prod the build will still succeed
// — the client will throw on first call, which is easier to spot than a silent
// misconfiguration.
if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
    "Auth-gated tabs will not function until these are set."
  );
}

export const supabase = createClient(url || "https://placeholder.supabase.co", anon || "placeholder-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // picks up the magic-link token from the URL hash on return
    flowType: "pkce",
  },
});

// Convenience flag for components that want to render a "Supabase not configured"
// message instead of crashing. True when env was populated at build time.
export const isSupabaseConfigured = Boolean(url && anon);
