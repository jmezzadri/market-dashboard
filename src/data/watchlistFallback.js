// WATCHLIST_FALLBACK — pre-auth seed watchlist used when the signed-in
// user has no watchlist rows yet, AND when scanData.watchlist (the
// single source of truth from the scanner artifact) is empty. Imported
// by App.jsx and by src/components/TickerDetailModal.jsx.
//
// Extracted from App.jsx as part of Phase 4b PR-A so that the modal
// extraction does not introduce a circular import.

export const WATCHLIST_FALLBACK = [
  { ticker: "NVDA", name: "NVIDIA Corp",          theme: "AI / Semis"        },
  { ticker: "AMAT", name: "Applied Materials",    theme: "Semi capex"        },
  { ticker: "CRWD", name: "CrowdStrike",          theme: "Cyber"             },
  { ticker: "CAT",  name: "Caterpillar",          theme: "Cyclical / Capex"  },
  { ticker: "MP",   name: "MP Materials",         theme: "Rare earth"        },
  { ticker: "KTOS", name: "Kratos Defense",       theme: "Defense / drones"  },
  { ticker: "AVAV", name: "AeroVironment",        theme: "Defense / drones"  },
  { ticker: "ONDS", name: "Ondas Holdings",       theme: "Defense / drones"  },
  { ticker: "LUNR", name: "Intuitive Machines",   theme: "Space / lunar"     },
];
