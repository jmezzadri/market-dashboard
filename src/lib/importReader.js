// importReader.js — universal tabular file reader for portfolio imports.
//
// One entry point that turns whatever a brokerage hands you into a single
// clean grid of rows and columns, with NO assumptions about column names or
// order. It handles:
//   - a real Excel workbook (.xlsx / .xls)
//   - a "web page pretending to be a spreadsheet" — an HTML <table> saved
//     with an .xls extension, which is what Chase / Schwab actually download
//   - a comma file (.csv) or tab file (.tsv)
//   - text the user pastes into the box
//
// Everything is routed through SheetJS so the same code reads all of those.
// SheetJS sniffs the real format from the file's bytes, so a misnamed file
// (HTML saved as .xls) still parses.
//
// Returns: { grid, headerRow, format, sheetCount, error }
//   grid       — string[][]; grid[0] is the detected header row, the rest are
//                data rows. Every cell is coerced to a trimmed string.
//   headerRow  — index (in the original sheet) where the header was found, so
//                a title/preamble line above the headers is skipped.
//
// Pure logic + dynamic SheetJS import. No React, no network.

const PREAMBLE_MAX_SCAN = 15; // how many top rows to scan for the real header

// Trim fully-empty rows and coerce every cell to a trimmed string.
function normalizeGrid(arr) {
  return (arr || [])
    .map((r) => (r || []).map((c) => (c == null ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c !== ""));
}

// Pick the header row. Brokerage exports often have a title line or a couple
// of blank rows above the real column headers. The header is the first row
// near the top with at least 3 filled cells; failing that, the row with the
// most filled cells in the first handful of rows.
function findHeaderRow(arr) {
  let best = 0;
  let bestFilled = -1;
  const limit = Math.min(arr.length, PREAMBLE_MAX_SCAN);
  for (let i = 0; i < limit; i++) {
    const filled = (arr[i] || []).filter((c) => String(c ?? "").trim() !== "").length;
    if (filled >= 3) return i; // a solid multi-column row — that's the header
    if (filled >= 2 && filled > bestFilled) {
      best = i;
      bestFilled = filled;
    }
  }
  return best;
}

function gridFromWorkbook(XLSX, wb) {
  const sheetName = (wb.SheetNames || [])[0];
  if (!sheetName) return { grid: [], headerRow: 0, error: "No sheet found in the file." };
  const ws = wb.Sheets[sheetName];
  const arr = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  const cleaned = normalizeGrid(arr);
  if (!cleaned.length) return { grid: [], headerRow: 0, error: "The file has no readable rows." };
  const hr = findHeaderRow(cleaned);
  return { grid: cleaned.slice(hr), headerRow: hr, sheetCount: (wb.SheetNames || []).length };
}

// Read an uploaded File/Blob (any of the formats above).
export async function readTabularFile(file) {
  if (!file) return { grid: [], headerRow: 0, format: "empty", error: "No file provided." };
  const XLSX = await import("xlsx");
  const name = (file.name || "").toLowerCase();
  const buf = await file.arrayBuffer();
  // type:"array" lets SheetJS sniff the real format from the bytes, so a
  // real .xlsx, an HTML-table .xls, and a .csv all land in the same grid.
  const wb = XLSX.read(buf, { type: "array" });
  const out = gridFromWorkbook(XLSX, wb);
  return {
    ...out,
    format: name.endsWith(".csv") ? "csv" : name.endsWith(".tsv") ? "tsv" : "spreadsheet",
  };
}

// Detect the delimiter on a line: tab, comma, semicolon, or pipe (whichever
// appears most). Falls back to comma.
function detectDelimiter(line) {
  const counts = {
    "\t": (line.match(/\t/g) || []).length,
    ",": (line.match(/,/g) || []).length,
    ";": (line.match(/;/g) || []).length,
    "|": (line.match(/\|/g) || []).length,
  };
  let best = ",";
  let bestN = 0;
  for (const [d, n] of Object.entries(counts)) if (n > bestN) { best = d; bestN = n; }
  return best;
}

// Split one delimited line, honoring "quoted, cells" and "" escapes.
function splitDelimitedLine(line, delim) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { q = false; }
      else { cur += ch; }
    } else {
      if (ch === delim) { out.push(cur); cur = ""; }
      else if (ch === '"') { q = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

// Read text pasted into the box. Parsed directly (not via SheetJS) so the
// behavior is identical in every browser — pasted content is always
// delimited text, and a deterministic split is the right tool for it.
export async function readPastedText(text) {
  if (!text || !text.trim()) return { grid: [], headerRow: 0, format: "empty" };
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = stripped.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { grid: [], headerRow: 0, format: "empty" };
  const delim = detectDelimiter(lines[0]);
  const cleaned = normalizeGrid(lines.map((l) => splitDelimitedLine(l, delim)));
  if (!cleaned.length) return { grid: [], headerRow: 0, format: "empty" };
  const hr = findHeaderRow(cleaned);
  return { grid: cleaned.slice(hr), headerRow: hr, format: "pasted" };
}

// Split a grid into { headers, dataRows }. Convenience for callers.
export function splitGrid(grid) {
  if (!grid || !grid.length) return { headers: [], dataRows: [] };
  return { headers: grid[0], dataRows: grid.slice(1) };
}
