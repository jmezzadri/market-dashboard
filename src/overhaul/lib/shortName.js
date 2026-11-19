/* "Intuitive Machines, Inc. Class A Common Stock" -> "Intuitive Machines".
   The vendor's registered name carries the share class and legal suffix; a
   table cell shows the company. Same rule as the Paper Portfolio holdings
   (src/v2/pages/PaperPortfolioPage.jsx shortName): strip at a word boundary
   (an unanchored match once turned Sinclair into "S") and drop the
   punctuation it leaves. The full name stays in the cell's tooltip.
   Health sweep 2026-11-19: the Watchlist printed "Intuitive Machines, Inc. …"
   and "Space Exploration Techn…" — the boilerplate pushed the company name
   itself past the ellipsis. */
export default function shortName(name) {
  const s = String(name || '')
    .replace(/,?\s+(Common Stock|Ordinary Shares?|Class [A-C]\b.*|Inc\.?|Corp\.?|Corporation|Incorporated|Holdings?|plc|Ltd\.?|N\.V\.|S\.A\.)(\s.*)?$/i, '')
    .replace(/[\s,.]+$/, '');
  return s || String(name || '');
}
