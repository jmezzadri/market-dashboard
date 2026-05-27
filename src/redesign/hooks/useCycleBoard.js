import { useEffect, useState } from "react";
export default function useCycleBoard() {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    fetch("/cycle_board_snapshot.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setState({ data: d, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setState({ data: null, loading: false, error: err }); });
    return () => { cancelled = true; };
  }, []);
  return state;
}
