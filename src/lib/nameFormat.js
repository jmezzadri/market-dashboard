// Company name normalization — reconcile the two sources of ticker names we
// pull from so display is consistent across the dashboard.
//
// Why this exists
// ---------------
// We get company names from two different feeds, each with its own casing style:
//
//   Yahoo Finance (validateTicker on add):  "NVIDIA Corp", "Caterpillar",
//                                           "CrowdStrike", "Applied Materials"
//   Unusual Whales (screener full_name):    "CAMECO CORP", "NETFLIX INC",
//                                           "ALPHABET INC", "GENERAL ELECTRIC CO"
//
// UW shouts every name in all caps. Rendering both sources side-by-side in a
// table (e.g., OTHER WATCHLIST where some rows have w.name from Yahoo and
// others fall through to sc.full_name from UW) produces visible inconsistency.
//
// Strategy
// --------
// Only transform strings that are entirely uppercase — if a name has any
// lowercase letter it's already properly-cased (Yahoo-sourced) and we leave
// it alone. That preserves brand casing like "NVIDIA Corp", "CrowdStrike",
// "AeroVironment", "iRobot", "eBay" which naive title-case would destroy.
//
// For the ALL-CAPS strings (UW-sourced), we title-case word-by-word with two
// refinements:
//   1. Short tokens (≤3 letters) are kept upper: "IBM", "HP", "GE", "3M",
//      "ETF", "USA", "UK" — usually acronyms or tickers-as-names.
//   2. A small dictionary fixes common corporate suffixes that shouldn't be
//      title-cased naively: "INC"→"Inc", "LLC"→"LLC", "PLC"→"PLC", etc.
//
// This isn't perfect — a company with an ALL-CAPS brand-acronym token longer
// than 3 letters (e.g. "NVIDIA CORPORATION" as a UW string) would come out as
// "Nvidia Corporation". In practice UW-sourced names with such brands are
// already proper-cased from Yahoo in our data, so this edge is rare.

const SUFFIX_FIX = {
  INC: "Inc",
  CORP: "Corp",
  CORPORATION: "Corporation",
  CO: "Co",
  COMPANY: "Company",
  LTD: "Ltd",
  LIMITED: "Limited",
  LLC: "LLC",
  LP: "LP",
  PLC: "PLC",
  NV: "NV",
  SA: "SA",
  AG: "AG",
  HOLDING: "Holding",
  HOLDINGS: "Holdings",
  GROUP: "Group",
  CLASS: "Class",
  TRUST: "Trust",
  FUND: "Fund",
  ETF: "ETF",
  REIT: "REIT",
  AND: "and",
  OF: "of",
  THE: "the",
  FOR: "for",
  // Deliberately omitted: IN, AT, ON — these collide with initialisms
  // ("AT&T", "ON Semiconductor") where we'd rather keep them UPPER than
  // lower-case them as English articles.
};

// Short-acronym preservation: we want "GE Co" to stay "GE Co" (not "Ge Co"),
// but "RED CAT HOLDINGS INC" to become "Red Cat Holdings Inc" (not
// "RED CAT Holdings Inc"). Naive ≤3-letter rule catches too many real words
// ("RED", "CAT", "NET", "WEB", "TOP"). Rule below:
//   • ≤2 letters all-caps (GE, HP, MP, AT, TV, SA) → preserve as acronym.
//   • Contains a digit (3M, 7UP, S&P) → preserve.
//   • Else title-case.
// Tradeoff: we lose IBM/UPS/CVS auto-preservation (they'd title-case to
// Ibm/Ups/Cvs), but those cases are rare in practice because Yahoo-sourced
// names for those tickers come in already properly cased.
function titleToken(tok, isFirst) {
  if (!tok) return tok;
  const u = tok.toUpperCase();
  // Preserve ampersand/slash/hyphen/comma fragments unchanged.
  if (!/[A-Z]/.test(u)) return tok;
  if (SUFFIX_FIX[u]) {
    const fixed = SUFFIX_FIX[u];
    // If the fixed form starts with a lowercase letter (and, of, the) and
    // we're at the first word of the name, upper-case the first letter.
    return isFirst ? fixed.charAt(0).toUpperCase() + fixed.slice(1) : fixed;
  }
  // ≤2-letter all-cap tokens → keep upper (GE, HP, MP, AT, TV).
  if (/^[A-Z0-9]{1,2}$/.test(tok)) return tok;
  // Tokens containing a digit → keep upper (3M, 7UP, S&P).
  if (/\d/.test(tok) && tok === tok.toUpperCase()) return tok;
  // Default: title case.
  return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
}

export function normalizeTickerName(name) {
  if (name == null) return name;
  const s = String(name).trim();
  if (!s) return s;
  // If the name is not entirely uppercase, assume it's properly cased from
  // Yahoo and leave it alone.
  if (s !== s.toUpperCase()) return s;
  // Split on whitespace but keep separators so we preserve spacing exactly.
  const parts = s.split(/(\s+)/);
  let wordIdx = 0;
  return parts
    .map(part => {
      if (/^\s+$/.test(part)) return part;
      // Further split on '&' / '-' / '/' so those aren't part of title logic.
      const subparts = part.split(/([&/\-,])/);
      const rebuilt = subparts
        .map(sp => {
          if (/^[&/\-,]$/.test(sp)) return sp;
          const out = titleToken(sp, wordIdx === 0);
          if (sp) wordIdx += 1;
          return out;
        })
        .join("");
      return rebuilt;
    })
    .join("");
}

export default normalizeTickerName;
