"""seed_paper_pipeline_health.py — one-shot seed/refresh of the three paper
pipeline_health rows so the Paper Portfolio freshness chips read real status.

Runs the same idempotent stamp the nightly OPEN/CLOSE phase now performs, but
standalone (no Alpaca, no trading) so it can be dispatched on demand to turn
the chips green immediately. Auth: SUPABASE_ACCESS_TOKEN (Management API).
"""
from paper_portfolio.mirror import stamp_paper_pipeline_health

if __name__ == "__main__":
    stamp_paper_pipeline_health()
    print("done: paper pipeline_health stamped")
