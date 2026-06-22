#!/usr/bin/env python3
"""Daily data-store reconciler — FLAGS discrepancies, never deletes.

Anchors on the manifest as the single source of truth and reports, same-day,
any of: (1) orphan series in the store with no manifest element; (2) a manifest
indicator wired to a sparse key when a deeper sibling exists; (3) duplicate
series (two keys, near-identical recent values); (4) stale 'PENDING' tags on
live deep series; (5) killed-feed residue still in the store. Exit 1 if any
P1-class discrepancy is found so the workflow goes red and files a bug.
Added 2026-06-16 — the standing guard against duplicate/rotten data stores.
"""
import json, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
hist = json.load(open(os.path.join(ROOT,'public/indicator_history.json')))
man  = json.load(open(os.path.join(ROOT,'public/data_manifest.json')))
killed = set()
kf = os.path.join(ROOT,'killed_elements.json')
if os.path.exists(kf):
    for e in json.load(open(kf)).get('killed',[]):
        killed.add(e.get('id',''))

KILLED_KEYS = {'adv_dec','bank_unreal','buffett','naaim','spx_above_200dma'}

store = {k:v for k,v in hist.items() if not k.startswith('__') and isinstance(v,dict)}
mapped, pending = {}, set()
for e in man['elements']:
    od = e.get('output_destination','') or ''
    m = re.search(r'indicator_history\.json\[([a-z_0-9]+)\]', od)
    if m:
        mapped[m.group(1)] = e.get('id')
        if 'PENDING' in od: pending.add(m.group(1))

flags = []  # (severity, message)

# 1) orphan series — in store, no manifest element
for k in store:
    if k not in mapped and k not in KILLED_KEYS:
        flags.append(('P2', f"orphan series '{k}' is stored but mapped to no manifest indicator — wire it or purge it"))

# 2) killed residue still in the store
for k in store:
    if k in KILLED_KEYS:
        flags.append(('P1', f"killed feed '{k}' still has rows in the store — purge producer+key"))

# 3) a sparse key whose deeper sibling sits unused — reconcile (NOT a displayed-tile claim:
#    registered in the manifest != rendered on the site; decide wire-or-purge by hand)
def npts(k): return len(store.get(k,{}).get('points',[]) or [])
SIBLINGS = {'ism':['ism_mfg','ism_svc']}  # extend as discovered
for k, sibs in SIBLINGS.items():
    if k in store:
        best = max(sibs, key=lambda s: npts(s)) if any(s in store for s in sibs) else None
        if best and npts(best) > npts(k) * 3:
            flags.append(('P2', f"'{k}' stored sparse ({npts(k)} pts) while deeper '{best}' ({npts(best)} pts) sits unused, and '{k}' is not a displayed indicator — decide: wire ISM as a real indicator off the deep series, or purge the sparse key + manifest entry"))

# 4) stale PENDING tags on live, deep series (>500 pts = clearly live)
for k in pending:
    if npts(k) > 500:
        flags.append(('P2', f"'{k}' is tagged PENDING in the manifest but is live with {npts(k)} pts — clear the stale tag"))

# 5) duplicate series — two keys whose last 60 values are ~identical
def tail(k,n=60):
    pts = store.get(k,{}).get('points',[]) or []
    return [round(float(v),6) for _,v in pts[-n:] if v is not None]
keys = list(store)
for i in range(len(keys)):
    for j in range(i+1,len(keys)):
        a,b = tail(keys[i]), tail(keys[j])
        if len(a) >= 30 and a == b:
            flags.append(('P2', f"'{keys[i]}' and '{keys[j]}' have identical recent values — likely duplicate series"))


# 6) engine-layer indicator visibility guard (added 2026-06-22, kill-buffett PR).
#    Every sub-indicator id referenced by the v11 engine's INDICATOR layer must be
#    visible to the freshness roll-ups: it must resolve to EITHER a manifest element
#    (by store-key mapping or by the element's `name`) OR — at runtime — a
#    public.pipeline_health row. A chip renders for any engine indicator id, so an
#    id with no manifest backing is invisible to freshness and is a P1 defect (this
#    is exactly how the retired 'buffett' input lingered after its feed died). Only
#    the engine's indicator-breakdown arrays are scanned — sector / industry-group
#    allocation ids are NOT freshness-tracked indicators and are excluded.
manifest_names = {e.get('name') for e in man['elements']
                  if (e.get('category') == 'indicator' or 'indicator-' in (e.get('id') or ''))}
tracked_ids = set(mapped) | {n for n in manifest_names if n}

# Calibration-only aliases that intentionally chart off a live tracked series
# (TiltPage CHART_ID map): hy_oas / hy_ig_ratio both open the tracked hy_ig OAS.
ENGINE_ALIASES = {'hy_oas': 'hy_ig', 'hy_ig_ratio': 'hy_ig'}

def _engine_indicator_ids():
    """Collect sub-indicator ids from the engine INDICATOR-breakdown layers only."""
    ids = set()
    def add(lst, key):
        for x in (lst or []):
            if isinstance(x, dict) and isinstance(x.get(key), str):
                ids.add(x[key])
    # methodology_calibration_v11.json: tiles[].indicators[] + composite_breakdown[]
    p = os.path.join(ROOT, 'public/methodology_calibration_v11.json')
    if os.path.exists(p):
        cal = json.load(open(p))
        for t in cal.get('tiles', []):
            add(t.get('indicators'), 'id')
            add(t.get('composite_breakdown'), 'indicator_id')
    # cycle_board_snapshot.json: mechanisms[].breakdown[]
    p = os.path.join(ROOT, 'public/cycle_board_snapshot.json')
    if os.path.exists(p):
        cb = json.load(open(p))
        for mech in cb.get('mechanisms', []):
            add(mech.get('breakdown'), 'id')
    # v10_allocation.json: mechanism_breakdown.<mechanism>[]
    p = os.path.join(ROOT, 'public/v10_allocation.json')
    if os.path.exists(p):
        v10 = json.load(open(p))
        mb = v10.get('mechanism_breakdown', {})
        if isinstance(mb, dict):
            for arr in mb.values():
                add(arr, 'id')
    return ids

for eid in sorted(_engine_indicator_ids()):
    resolved = ENGINE_ALIASES.get(eid, eid)
    if resolved in tracked_ids or eid in tracked_ids or eid in killed or eid in KILLED_KEYS:
        continue
    flags.append(('P1', f"engine indicator '{eid}' renders a chip but has NEITHER a manifest "
                        f"element NOR a pipeline_health row — it is invisible to the freshness "
                        f"roll-ups; register it or remove it from the engine files"))

p1 = [m for s,m in flags if s=='P1']
print(f"Data reconciler: {len(store)} stored series, {len(mapped)} mapped. {len(flags)} discrepancy(ies).")
for s,m in sorted(flags): print(f"  [{s}] {m}")
if not flags: print("  clean — every stored series reconciles to the manifest.")
sys.exit(1 if p1 else 0)
