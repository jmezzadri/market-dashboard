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

p1 = [m for s,m in flags if s=='P1']
print(f"Data reconciler: {len(store)} stored series, {len(mapped)} mapped. {len(flags)} discrepancy(ies).")
for s,m in sorted(flags): print(f"  [{s}] {m}")
if not flags: print("  clean — every stored series reconciles to the manifest.")
sys.exit(1 if p1 else 0)
