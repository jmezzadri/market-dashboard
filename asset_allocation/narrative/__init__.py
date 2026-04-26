"""
asset_allocation.narrative — Layer 4-narrative: rule-based prose generation.

Pure functions, no LLM. Every output is deterministic given the same input
state. CI fails if templates produce different output for the same input.

Submodules:
  templates  — core rendering helpers (qualifiers, comparison phrases, etc.)
  rationale  — per-bucket rationale paragraphs
  headline   — top-level macro narrative (3 paragraphs)
  themes     — cross-bucket theme detection (e.g., "AI infrastructure")
  risks      — kill-factor-driven risk scenarios

The narrative engine reads the state-layer output (allocation_with_state.json)
and writes templated text into the previously-empty fields:
  headline.narrative
  headline.active_themes
  macro_narrative[]
  themes[]
  ratings.<tier>[].rationale
  ratings.<tier>[].key_factors
  risk_scenarios[]
"""

__version__ = "0.1.0"
