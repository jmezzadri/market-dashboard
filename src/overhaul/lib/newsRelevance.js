/* Is a headline about this stock? (health sweep 2026-11-26)

   The per-ticker news search matches the symbol as plain text, so a short or
   common-word symbol pulls in other companies and machine-made pages:
     DE   -> "Électricité De Strasbourg (ENXTPA:ELEC)", "Verve Group (VRV.DE)",
             "Stock Selloff Is 'Total De-Risking Going On'"
     KO   -> "Coca Cola Femsa (KOF)"
     LUNR -> "LUNR261127P00013500 Interactive Stock Chart | LUNR Nov 2026
             13.500 put Stock" (six of ten rows), "LunR Royalties"
   A headline is kept when it names the symbol exactly (upper case, not part
   of another listing such as "VRV.DE") or names the company; it is dropped
   when it is an option-contract quote page, when it tags only a different
   listing in brackets, or when it mentions neither the symbol nor the
   company. */
import shortName from './shortName';

const OPTION_SYMBOL = /\b[A-Z]{1,6}\d{6}[CP]\d{8}\b/;
const GENERIC_FIRST = new Set(['the', 'first', 'united', 'american', 'general', 'national', 'global', 'international', 'new', 'great', 'western', 'eastern', 'north', 'south', 'us', 'u.s.']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s || '').toLowerCase().replace(/[-‐-―]/g, ' ').replace(/[’']/g, "'").replace(/\s+/g, ' ');

export function companyKeys(name) {
  const short = norm(shortName(name || '')).replace(/[,.]/g, '').trim();
  if (!short) return [];
  const words = short.split(' ').filter(Boolean);
  const keys = [short];
  const first = words[0] === 'the' ? words[1] : words[0];
  if (first && first.length >= 4 && !GENERIC_FIRST.has(first)) keys.push(first);
  else if (words.length >= 2) keys.push(words.slice(0, 2).join(' '));
  return [...new Set(keys)];
}

export function isAboutTicker(headline, sym, keys = []) {
  const h = String(headline || '');
  const s = String(sym || '').toUpperCase();
  if (!h || !s) return false;
  if (OPTION_SYMBOL.test(h)) return false;
  const exact = new RegExp(`(^|[^A-Za-z0-9.])${esc(s)}(?![A-Za-z0-9]|\\.[A-Za-z])`).test(h);
  const nh = norm(h);
  const named = keys.some((k) => k && nh.includes(k));
  if (exact) return true;
  if (!named) return false;
  // Names the company but tags only a different listing: "Coca Cola Femsa (KOF)".
  const tags = [...h.matchAll(/\(([A-Z0-9][A-Z0-9.:\-]{0,18})\)/g)].map((m) => m[1]);
  if (tags.length && !tags.some((t) => t.split(/[:.]/).includes(s))) return false;
  return true;
}
