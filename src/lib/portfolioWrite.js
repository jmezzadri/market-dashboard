// portfolioWrite.js — the two write paths the smart importer dispatches to,
// pulled out so the import UI stays thin and the insert logic lives in one
// testable place.
//
//   writeTransactions(rows)            → buy/sell ledger via the de-duping
//                                        import_transactions database function
//                                        (which also rebuilds positions).
//   writeHoldings(userId, rows, mode)  → current holdings into accounts +
//                                        positions, MERGE (update/add) or
//                                        REPLACE (wipe + reload).
//
// The holdings path mirrors the legacy positions importer exactly (column
// shape, seed price/value, scanner fan-out) so behavior is identical — only
// the front door changed.

import { supabase } from "./supabase";

// ── validation + grouping for holdings ──────────────────────────────────────
// Returns { accounts: Map<label, position[]>, errors: string[] }.
export function groupHoldingsForInsert(rows) {
  const errors = [];
  const accounts = new Map();
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i];
    const labelRaw = (r.account || "").toString().trim();
    const tickerRaw = (r.ticker || "").toString().trim().toUpperCase();
    if (!labelRaw) { errors.push(`Row ${i + 2}: no account name`); continue; }
    if (!tickerRaw) { errors.push(`Row ${i + 2}: no ticker`); continue; }

    const quantityNum = Number(String(r.quantity).replace(/[$,\s]/g, ""));
    const costNum = Number(String(r.cost_per_share).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
      errors.push(`Row ${i + 2}: quantity must be a positive number (saw "${r.quantity}")`);
      continue;
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      errors.push(`Row ${i + 2}: cost per share must be zero or more (saw "${r.cost_per_share}")`);
      continue;
    }
    const purchaseDate = (r.purchase_date || "").toString().trim();
    let normDate = null;
    if (purchaseDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
        normDate = purchaseDate;
      } else {
        // Accept common M/D/YYYY too — the file may not use ISO dates.
        const m = purchaseDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (m) {
          let yy = parseInt(m[3], 10);
          if (yy < 100) yy = 2000 + yy;
          normDate = `${yy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
        }
        // If still unparseable, leave the date out rather than reject the row.
      }
    }

    if (!accounts.has(labelRaw)) accounts.set(labelRaw, []);
    accounts.get(labelRaw).push({
      ticker: tickerRaw,
      name: tickerRaw,
      quantity: quantityNum,
      cost_per_share: costNum,
      purchase_date: normDate,
      seed_value: quantityNum * costNum,
    });
  }
  return { accounts, errors };
}

function buildPosRow(p, { user_id, account_id, sort_order }) {
  return {
    user_id,
    account_id,
    ticker: p.ticker,
    name: p.name,
    quantity: p.quantity,
    avg_cost: p.cost_per_share,
    price: p.cost_per_share,
    ingested_price: p.cost_per_share,
    value: p.seed_value,
    purchase_date: p.purchase_date,
    sector: null,
    beta: null,
    analysis: null,
    sort_order,
  };
}

async function fanOutScan(rows) {
  // Best-effort: warm name/sector/beta for imported tickers, 5 at a time so
  // the data vendor isn't hammered. One bad ticker never fails the set.
  const tickers = Array.from(new Set(
    (rows || [])
      .map((r) => String(r?.ticker || "").trim().toUpperCase())
      .filter((t) => t && t.length <= 10 && t !== "CASH")
  ));
  if (!tickers.length) return;
  try {
    const { data: sessData } = await supabase.auth.getSession();
    const token = sessData?.session?.access_token;
    if (!token) return;
    const queue = [...tickers];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        if (!t) break;
        try {
          await fetch("/api/scan-ticker", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ticker: t }),
          });
        } catch (_) { /* per-ticker best effort */ }
      }
    };
    await Promise.allSettled(Array.from({ length: Math.min(5, tickers.length) }, worker));
  } catch (_) { /* fan-out is non-critical */ }
}

// ── holdings write ──────────────────────────────────────────────────────────
export async function writeHoldings(userId, holdingRows, strategy = "merge") {
  const { accounts, errors } = groupHoldingsForInsert(holdingRows);
  if (errors.length) return { ok: false, errors: errors.slice(0, 8) };
  if (!accounts.size) return { ok: false, errors: ["No valid holdings to import."] };

  if (strategy === "replace") {
    const { error: delPos } = await supabase.from("positions").delete().eq("user_id", userId);
    if (delPos) throw delPos;
    const { error: delAcct } = await supabase.from("accounts").delete().eq("user_id", userId);
    if (delAcct) throw delAcct;

    const acctPayload = Array.from(accounts.keys()).map((label, i) => ({ user_id: userId, label, sort_order: i }));
    const { data: acctRows, error: acctErr } = await supabase.from("accounts").insert(acctPayload).select("id,label");
    if (acctErr) throw acctErr;
    const labelToId = new Map(acctRows.map((a) => [a.label, a.id]));
    const posPayload = [];
    let sort = 0;
    for (const [lbl, posList] of accounts.entries()) {
      const account_id = labelToId.get(lbl);
      for (const p of posList) posPayload.push(buildPosRow(p, { user_id: userId, account_id, sort_order: sort++ }));
    }
    if (posPayload.length) {
      const { error: posErr } = await supabase.from("positions").insert(posPayload);
      if (posErr) throw posErr;
    }
    await fanOutScan(holdingRows);
    return { ok: true, accounts: accounts.size, positions: posPayload.length };
  }

  // MERGE — update matching (account, ticker), insert the rest, keep the rest.
  const [{ data: existingAccts, error: eAErr }, { data: existingPos, error: ePErr }] = await Promise.all([
    supabase.from("accounts").select("id,label").eq("user_id", userId),
    supabase.from("positions").select("id,account_id,ticker").eq("user_id", userId),
  ]);
  if (eAErr) throw eAErr;
  if (ePErr) throw ePErr;

  const labelToId = new Map((existingAccts || []).map((a) => [a.label, a.id]));
  const posKey = (aid, t) => `${aid}::${t}`;
  const posIdBy = new Map((existingPos || []).map((p) => [posKey(p.account_id, p.ticker), p.id]));

  const newLabels = [];
  for (const lbl of accounts.keys()) if (!labelToId.has(lbl)) newLabels.push(lbl);
  if (newLabels.length) {
    const startOrder = labelToId.size;
    const { data: created, error: cErr } = await supabase
      .from("accounts")
      .insert(newLabels.map((label, i) => ({ user_id: userId, label, sort_order: startOrder + i })))
      .select("id,label");
    if (cErr) throw cErr;
    for (const a of created) labelToId.set(a.label, a.id);
  }

  const toUpdate = [];
  const toInsert = [];
  let sortCursor = posIdBy.size;
  for (const [lbl, posList] of accounts.entries()) {
    const account_id = labelToId.get(lbl);
    for (const p of posList) {
      const key = posKey(account_id, p.ticker);
      const existingId = posIdBy.get(key);
      const patch = {
        name: p.name, quantity: p.quantity, avg_cost: p.cost_per_share,
        price: p.cost_per_share, value: p.seed_value, purchase_date: p.purchase_date,
      };
      if (existingId) toUpdate.push({ id: existingId, patch });
      else toInsert.push(buildPosRow(p, { user_id: userId, account_id, sort_order: sortCursor++ }));
    }
  }
  if (toUpdate.length) {
    const results = await Promise.all(toUpdate.map(({ id, patch }) => supabase.from("positions").update(patch).eq("id", id)));
    const firstErr = results.find((r) => r.error);
    if (firstErr) throw firstErr.error;
  }
  if (toInsert.length) {
    const { error: insErr } = await supabase.from("positions").insert(toInsert);
    if (insErr) throw insErr;
  }
  await fanOutScan(holdingRows);
  return { ok: true, accounts: accounts.size, updated: toUpdate.length, inserted: toInsert.length };
}

// ── transactions write ──────────────────────────────────────────────────────
export async function writeTransactions(transactions) {
  const payload = (transactions || []).map((t) => {
    const { raw, rowNum, classification, ...keep } = t; // strip preview-only fields
    return keep;
  });
  if (!payload.length) return { inserted: 0, duplicates: 0, errors: [] };
  const { data, error } = await supabase.rpc("import_transactions", { p_rows: payload });
  if (error) throw error;
  return data;
}
