// massive-smoke-test — minimal endpoint that calls Massive once with a
// limit=5 Reference Tickers query to confirm MASSIVE_API_KEY is wired.
//
// Used by Phase 1 UAT before kicking off the real ingest jobs.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { smokeTest } from "../_shared/massive.ts";

serve(async (_req) => {
  const result = await smokeTest();
  return new Response(JSON.stringify(result, null, 2), {
    status: result.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
