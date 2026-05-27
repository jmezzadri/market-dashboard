// useScanData — load the daily scanner snapshot (same source App.jsx uses).
import { useEffect, useState } from "react";
const SCAN_URL = "https://raw.githubusercontent.com/jmezzadri/market-dashboard/main/public/latest_scan_data.json?t=";
export default function useScanData() {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    fetch(SCAN_URL + Date.now())
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setState({ data: d, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setState({ data: null, loading: false, error: err }); });
    return () => { cancelled = true; };
  }, []);
  return state;
}
