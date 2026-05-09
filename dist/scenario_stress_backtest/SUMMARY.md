# Scenario stress backtest — 2026-05-09

Mechanism tolerance: ±15pp · composite tolerance: ±10pp · history window from 2011-01-01.

| scenario | calib status | peak | val | cred | fund | grow | liq | pos | composite |
|---|---|---|---|---|---|---|---|---|---|
| black_monday_1987 | draft | 1987-10-19 | self-attest | self-attest | self-attest | — | self-attest | self-attest | self-attest |
| dotcom_slow_2000 | draft | 2000-03-10 | self-attest | self-attest | self-attest | — | self-attest | self-attest | self-attest |
| dotcom_capitulation_2002 | draft | 2002-10-09 | self-attest | self-attest | self-attest | — | self-attest | self-attest | self-attest |
| gfc_2008 | seeded | 2008-11-20 | ✓ (-6) | ✓ (+0) | ✓ (+8) | — | ✓ (+0) | ✗ (+17) | ✓ (+4) |
| q4_2018 | draft | 2018-12-24 | ✓ (-15) | ✓ (-5) | ✓ (+9) | — | ✓ (+14) | ✓ (-3) | ✓ (+1) |
| covid_2020 | seeded | 2020-03-23 | ✓ (-10) | ✗ (+22) | ✓ (-4) | — | ✓ (+2) | ✓ (+10) | ✓ (+4) |
| inflation_2022 | seeded | 2022-10-12 | ✗ (-16) | ✗ (-25) | ✓ (+4) | — | ✓ (+9) | ✓ (-5) | ✓ (-7) |
| ai_2024 | draft | 2024-08-05 | ✓ (-14) | ✓ (-3) | ✓ (+13) | — | ✓ (-7) | ✓ (-13) | ✓ (-5) |

**Mechanism failures**: 4  ·  **Composite failures**: 0  ·  **Observable pairs evaluated**: 25
