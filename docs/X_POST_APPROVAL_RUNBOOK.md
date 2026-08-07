# Daily X Chart — approve-by-email auto-posting

**Status:** built 2026-08-06. Dormant until X posting credentials exist in `ops_secrets`.
Owner: Lead Developer. Joe's approval model: **nothing posts to X without his tap.**

## How it works

1. **7:05am ET weekdays** — the existing "MacroTilt Daily X Chart" scheduled run produces the
   chart + caption exactly as before, then:
   - inserts a row into `public.x_pending_posts` (post_date, caption, random `approval_token`),
   - writes `meta.json` (post_date, approve_url, changes_url) next to `chart.png` / `caption.txt`,
   - pushes all three to the `x-charts` branch, then stamps the row with the push commit sha.
2. **X-CHART-EMAIL action** (on `x-charts`) — sees a fresh `meta.json` and sends the HTML
   approval email: chart inline, caption, **Approve & post to X** and **Request changes** buttons.
   No/stale `meta.json` → falls back to the legacy manual email. Fully backward compatible.
3. **`x-post-approval` edge function** (deployed, verify_jwt off, token-auth):
   - `a=approve` → one-shot claim (double-taps can't double-post) → fetches `chart.png` from the
     pinned commit via GitHub API → uploads media to X (v2, v1.1 fallback) → `POST /2/tweets`
     with OAuth 1.0a user context → marks row `posted` with the tweet URL → "Posted ✓" page.
   - `a=changes` → phone-friendly form → saves feedback, row → `changes_requested`.
   - Guards: same-day-ET expiry (yesterday's chart can never post), single-use claim,
     wrong/missing token → 400, missing creds → friendly "not wired up" page, row untouched.
4. **Checker run** (hourly 8:35am–1:35pm ET weekdays, created at activation) — regenerates on
   `changes_requested` (full quality bar, honoring Joe's feedback), re-pushes with a fresh token
   (`revision: true`), which re-emails; flags `failed` rows.

## `x_pending_posts` states

`pending` → (`changes_requested` → `pending` on re-push)* → `approved` → `posted`
Other exits: `failed` (posting error; retry allowed), `expired` (not same-day), `cancelled`.

## Activation checklist (in order — do not flip the trigger prompt early)

1. Posting credentials in `ops_secrets` (names the function reads) — EITHER route:
   - **Route A, X API:** `x_api_key`, `x_api_secret`, `x_access_token`, `x_access_token_secret`
     (X developer app on @WeTheSheeple46, Read+Write, pay-per-use credits).
     ⚠ 2026-08-06: X blocked @WeTheSheeple46's developer signup — "account has been flagged,
     contact support." Route A unavailable until the flag clears.
   - **Route B, Typefully (implemented, active fallback):** `typefully_api_key` only.
     Function auto-discovers and caches `typefully_social_set_id`. Flow: media slot →
     presigned PUT → poll ready → draft with `publish_at: "now"`.
2. Merge the `x-charts` workflow PR and the `main` function-source PR.
3. Dry-run: insert a manual test row + push a test meta.json off-hours; Joe taps approve on a
   throwaway caption; verify tweet lands; delete the tweet if desired.
4. Update the "MacroTilt Daily X Chart" trigger prompt (delivery step becomes: insert row →
   meta.json → push → stamp sha → verify email). Create the checker trigger.
5. Next morning: verify the real email has buttons; after Joe's tap, verify the post is live and
   the row is `posted`.

## Rollback

Delete `meta.json` from the trigger's push list (or revert the trigger prompt): the email action
instantly falls back to the legacy manual email. The edge function and table can sit unused.

## Cost note (X API, Feb 2026 pricing)

Free tier is discontinued; pay-per-use ≈ $0.20/post containing a URL (the caption ends in
macrotilt.com), so ~22 weekday posts ≈ **$4–5/month**. Alternative if Joe prefers zero X dev
setup: Typefully API (supports image upload + publish); function has a `typefully_api_key`
secret slot reserved but that path is not implemented yet.

---

## 2026-08-06 late-night addendum — system went LIVE

**First live post:** https://x.com/WeTheSheeple46/status/2085542700640850086 (Tax & Spend inaugural,
approved by Joe via email button, published via Typefully).

**Architecture changes discovered/shipped tonight:**

1. **Scheduled sandboxes cannot git-push** (since ~Aug 5 the git proxy strips tokens; the Daily Chart
   run's own words: "repo isn't in the session's authorized sources"). ALL trigger prompts now deliver
   x-charts content via the permanent **`gh-push` edge function** (single Git-Data-API commit;
   auth = `ops_secrets.gh_push_token`; branch allowlist: x-charts only). No git in trigger sessions.
2. **X policy blocks Typefully instant-publish of posts containing URLs** ("Direct publishing of X
   drafts containing URLs is blocked"). `x-post-approval` v3 always publishes via the scheduled queue
   ~90s out — verified live tonight. Approve page says "posts within ~2 minutes."
3. **KNOWN ISSUE — approval pages render as raw code:** supabase.co edge functions now coerce
   text/html responses to text/plain (anti-phishing, started mid-evening Aug 6). The Approve button
   still WORKS (action fires server-side) but the result page shows source, and the Request-changes
   FORM is unusable. Interim: Joe requests changes by telling the agent in chat. FIX PLAN: add a
   proxy route on macrotilt.com (Vercel app, e.g. /api/xapprove) that forwards to the Supabase
   function and returns the HTML with correct content-type; then update meta.json URL bases in the
   three trigger prompts.
4. Trigger roster (all delivery via gh-push): Daily Chart trig_01UaY4TiJ5mQ4PhN3fPduKce (7:05a ET wd),
   queue checker trig_01QFJXd8JCtXoX4LgYQHC18p (8:35a–1:35p ET wd hourly), Tax & Spend
   trig_01PGunLQjiXTt4qNrtHnu6jd (Sun/Tue/Thu 12:30p ET). Typefully creds: ops_secrets
   typefully_api_key + typefully_social_set_id (325176).
