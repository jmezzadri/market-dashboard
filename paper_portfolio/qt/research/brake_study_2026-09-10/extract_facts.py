"""Extract the nine v3 tags from SEC companyfacts.zip for EVERY CIK (dead companies included).
Output: facts.parquet (cik, tag, period_end, filed, fp, val) + entities.parquet (cik, name)."""
import json, math, zipfile, re
import pandas as pd

TAGS = ["GrossProfit", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
        "CostOfRevenue", "CostOfGoodsAndServicesSold", "Assets",
        "NetCashProvidedByUsedInOperatingActivities",
        "WeightedAverageNumberOfDilutedSharesOutstanding", "CommonStockSharesOutstanding"]
FORMS = ("10-K", "10-Q")
SINCE = "2015-06-01"

z = zipfile.ZipFile("companyfacts.zip")
names = [n for n in z.namelist() if n.startswith("CIK") and n.endswith(".json")]
print("files", len(names), flush=True)
rows, ents, n = [], [], 0
for nm in names:
    try:
        d = json.loads(z.read(nm))
    except Exception:
        continue
    cik = int(d.get("cik") or nm[3:13])
    ents.append((cik, d.get("entityName") or ""))
    g = d.get("facts", {}).get("us-gaap", {})
    for tag in TAGS:
        for unit, arr in (g.get(tag, {}).get("units", {}) or {}).items():
            if unit not in ("USD", "shares"):
                continue
            for it in arr:
                if it.get("form") not in FORMS: continue
                if not it.get("filed") or it.get("val") is None or not it.get("end"): continue
                if it["filed"] < SINCE: continue
                try:
                    val = float(it["val"])
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(val): continue
                rows.append((cik, tag, it["end"], it["filed"], it.get("fp"), val))
    n += 1
    if n % 2000 == 0:
        print(f"  {n:,} companies · {len(rows):,} facts", flush=True)

df = pd.DataFrame(rows, columns=["cik", "tag", "period_end", "filed", "fp", "val"])
df = df.sort_values("filed").drop_duplicates(["cik", "tag", "period_end"], keep="last")
df.to_parquet("facts.parquet", index=False)
pd.DataFrame(ents, columns=["cik", "name"]).to_parquet("entities.parquet", index=False)
print(f"parsed {len(df):,} facts across {df.cik.nunique():,} companies", flush=True)
