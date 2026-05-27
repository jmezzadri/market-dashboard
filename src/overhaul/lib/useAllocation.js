/* useAllocation — loads /v10_allocation.json (the Asset Tilt engine output).
   Returns equity/defensive split, mechanism scores, sector tilts, IGs. */

import { useEffect, useState } from 'react';

export default function useAllocation() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let c = false;
    fetch('/v10_allocation.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!c) setData(d); })
      .catch((e) => { if (!c) setErr(e?.message); });
    return () => { c = true; };
  }, []);

  return { allocation: data, loading: data == null, error: err };
}
