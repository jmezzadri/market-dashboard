import React, { useEffect, useState } from 'react';
import CountUp from '../components/CountUp';
import { supabase } from '../../lib/supabase';

export default function AdminPageV2() {
  const [bugs, setBugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!supabase) { setErr('supabase not initialized'); setLoading(false); return; }
    supabase.from('open tickets')
      .select('report_number, priority, status, title, reporter_email, created_at')
      .not('status', 'in', '(closed,wontfix,duplicate,verified_closed,resolved)')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setBugs(data || []);
        setLoading(false);
      });
  }, []);
  const counts = { P0: bugs.filter((b) => b.priority === 'P0').length, P1: bugs.filter((b) => b.priority === 'P1').length, P2: bugs.filter((b) => b.priority === 'P2').length };
  return (
    <div className="v2-root">
      <header className="v2-hero">
        <div className="arc" aria-hidden="true">
          <svg viewBox="0 0 600 600" preserveAspectRatio="xMaxYMid slice">
            <g transform="translate(420 300)">{[60,100,140,180,220,260,300,340].map((r) => <circle key={r} r={r} />)}</g>
          </svg>
        </div>
        <div className="v2-shell">
          <div className="v2-hero-row">
            <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>Admin.</h1>
          </div>
          <div className="v2-stats" style={{ marginTop: 28 }}>
            <div className="s down"><span className="lbl">Open P0</span><span className="v"><CountUp to={counts.P0} /></span><span className="d">blockers</span></div>
            <div className="s warn"><span className="lbl">Open P1</span><span className="v"><CountUp to={counts.P1} /></span><span className="d">user impact</span></div>
            <div className="s"><span className="lbl">Open P2</span><span className="v"><CountUp to={counts.P2} /></span><span className="d">paper cuts</span></div>
            <div className="s"><span className="lbl">Total open</span><span className="v"><CountUp to={bugs.length} /></span><span className="d">open tickets</span></div>
          </div>
        </div>
      </header>
      <div className="v2-shell" style={{ marginTop: 32 }}>
        <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['#', 'Pri', 'Title', 'Status', 'Filed by', 'Day'].map((h, i) => (
                <th key={h} style={{ textAlign: i === 5 ? 'right' : 'left', padding: '14px 28px', fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-2)', fontWeight: 500, borderBottom: '1px solid var(--line-1)', background: 'var(--bg-1)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="6" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-2)' }}>Loading from open tickets…</td></tr>}
              {err && <tr><td colSpan="6" style={{ padding: 32, textAlign: 'center', color: 'var(--down)' }}>{err}</td></tr>}
              {bugs.map((b) => (
                <tr key={b.report_number}>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-0)', fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontFeatureSettings: '"tnum"', fontSize: 14 }}>{b.report_number}</td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)' }}>
                    <span className={`v2-pill ${b.priority === 'P0' ? 'r-off' : b.priority === 'P1' ? 'r-cau' : 'r-neu'}`} style={{ minWidth: 30, justifyContent: 'center' }}>{b.priority}</span>
                  </td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-1)' }}>{b.title}</td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase' }}>{b.status}</td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-2)', fontSize: 12 }}>{(b.reporter_email || '').split('@')[0]}</td>
                  <td style={{ padding: '14px 28px', borderBottom: '1px solid var(--line-0)', color: 'var(--ink-2)', fontSize: 12, fontFeatureSettings: '"tnum"', textAlign: 'right' }}>{new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
