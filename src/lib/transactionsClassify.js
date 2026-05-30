// transactionsClassify.js — classify already-parsed rows into trades.
//
// This is the seam the flexible importer feeds into: it takes rows that have
// been mapped (from ANY broker's layout) into objects keyed by the canonical
// Chase header names, and runs each through the existing, signed-off
// mapChaseRowToTransaction logic — option multiplier, realized P&L,
// long/short-term, dedup key. Kept in its own file so the proven
// chaseImporter.js is not touched and its 34 passing tests are undisturbed.
//
// Pure logic. No React, no network, no DOM.

import { mapChaseRowToTransaction } from "./chaseImporter.js";

export function classifyRows(rows, { rowOffset = 2 } = {}) {
  const transactions = [];
  const skipped = [];
  const rowErrors = [];

  (rows || []).forEach((rawRow, idx) => {
    const { tx, classification, error } = mapChaseRowToTransaction(rawRow);
    const rowNum = idx + rowOffset;
    if (tx) {
      transactions.push({ rowNum, classification, ...tx, raw: rawRow });
    } else if (classification === "skipped") {
      skipped.push({ rowNum, reason: error, raw: rawRow });
    } else {
      rowErrors.push({ rowNum, reason: error, raw: rawRow });
    }
  });

  return { transactions, skipped, errors: rowErrors, headerErrors: [] };
}
