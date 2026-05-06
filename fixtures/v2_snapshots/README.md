# v2 Cutover Snapshot Fixtures

One JSON file per v2 tab. Each file is a contract: the rendered page MUST
contain every string listed under `required_*`, and MUST NOT contain any
string listed under `banned_strings_in_rendered_paths` outside the
`exempt_locations`.

The CI checker is `scripts/check_v2_snapshot_fixtures.py`. It reads each
fixture and validates the corresponding `page_file` against the contract
by static text inspection — fast, deterministic, no React runtime
required. (Future: extend to a Playwright DOM-snapshot mode once a v2
test harness is available.)

Add a new fixture when a tab passes the 12-theme review and both the
UX Designer and Senior Quant sub-agents sign off. The fixture is the
"locked" contract — changes to it carry the same UX + Quant sign-off
bar as the page itself.

## Schema (v1)

```jsonc
{
  "tab_id": "macro_overview",                 // unique slug per tab
  "page_file": "src/v2/pages/MacroOverviewPage.jsx",
  "description": "...",                        // human-readable summary
  "required_section_headings": [               // top-level section labels
    "Cycle Mechanism Board",                   //   the page MUST render
    ...
  ],
  "required_labels": [                         // labels / stat captions
    "Mechanisms flagged",
    ...
  ],
  "required_lexicon_states": [                 // Theme #3 — v2 lexicon
    "Risk On", "Neutral", "Cautionary", "Risk Off"
  ],
  "required_mechanisms": [                     // entities by canonical name
    {"id": "valuation", "name": "Valuation"},
    ...
  ],
  "required_tooltips_for_labels": [            // Theme #6 — every named
    "Mechanisms flagged",                      //   label has a tooltip
    ...
  ],
  "required_source_attribution_pattern":       // Theme #5 — Vendor · As of
    "Source · As of",
  "required_drilldown_targets": [              // Theme #9 — every aggregate
    "Mechanism → Inputs",                      //   reaches its components
    "Composite → Mechanisms"
  ],
  "banned_strings_in_rendered_paths": [        // Theme #3 / #5 / #7
    "Stressed", "Distressed", "Concerning", "Complacent",
    "complacency", "complacent",
    "Tilt points", "History points", "OVR",
    "pipeline_health", "INDICATOR-REFRESH",
    "#0071e3", "#007AFF"
  ],
  "exempt_locations": [                        // strings allowed only in
    {                                          //   these specific places
      "file": "src/v2/pages/MacroOverviewPage.jsx",
      "line_pattern": "STANCE_MAP",
      "tokens": ["Stressed", "Distressed",
                 "Concerning", "Complacent", "Normal"],
      "reason": "Defensive remap collapsing legacy labels to v2 lexicon."
    }
  ]
}
```

## Status

| Tab            | Fixture                         | Locked |
|----------------|---------------------------------|--------|
| Macro Overview | `v2_macro_overview.json`        | yes    |
| Home           | (queued)                        | no     |
| Asset Tilt     | (queued)                        | no     |
| Trading Opps   | (queued)                        | no     |
| Indicators     | (queued)                        | no     |
| Insights       | (queued)                        | no     |
| Methodology    | (queued)                        | no     |
| Scenarios      | (queued)                        | no     |
| Admin          | (queued)                        | no     |

Each tab fixture is locked when both the UX Designer and the Senior
Quant sub-agents sign off on the corresponding cutover PR, and the CI
checker passes against `origin/main`.
