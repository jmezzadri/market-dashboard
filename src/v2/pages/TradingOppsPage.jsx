import React, { useEffect, useMemo, useState } from 'react';
import CountUp from '../components/CountUp';
import FreshnessChip from '../components/FreshnessChip';

export default function TradingOppsPage() {
  const [scan, setScan] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch('/latest_scan_data.json', { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : null).then(setScan).catch((e) => setErr(e?.message));
  }, []);

  const picks = scan?.signals?.composite_picks || scan?.picks || [];
  const buys = picks.filter((p) => (p.composite_score || p.score || 0) >= 80);
  const nears = picks.filter((p) => {
    const s = p.composite_score || p.score || 0;
    return s >= 70 && s < 80;
  });
  const insider = scan?.signals?.insider_buys?.items || scan?.signals?.insider?.items || [];
  const congress = scan?.signals?.congress_trades?.items || scan?.signals?.congress?.items || [];
  const universeSize = scan?.meta?.universe_size || scan?.universe_size || null;

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
            <h1 className="t-display" style={{ margin: 0, color: 'var(--ink-0)' }}>Today's opps.</h1>
            <FreshnessChip elementId="latest_scan" fallback={scan?.scan_time} />
          </div>
          <div className="v2-stats" style={{ marginTop: 28 }}>
            <div className="s up"><span className="lbl">Buy alerts</span><span className="v"><CountUp to={buys.length} /></span><span className="d">scored 80+</span></div>
            <div className="s warn"><span className="lbl">Near triggers</span><span className="v"><CountUp to={nears.length} /></span><span className="d">scored 70-79</span></div>
            <div className="s"><span className="lbl">Insider buys (5d)</span><span className="v"><CountUp to={insider.length} /></span><span className="d">SEC Form 4</span></div>
            <div className="s"><span className="lbl">Universe</span><span className="v">{universeSize != null ? <CountUp to={universeSize} format={(v)=>`${(v/1000).toFixed(1)}K`} /> : '—'}</span><span className="d">scanned tonight</span></div>
          </div>
        </div>
      </header>

      <div className="v2-shell">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, padding: '32px 0 0' }} className="v2-asset-grid">
          {/* BUYS */}
          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line-0)', paddingBottom: 14, marginBottom: 14 }}>
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}><span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: 'rgba(109,212,158,.16)', color: 'var(--up)', letterSpacing: '.04em', marginRight: 10 }}>BUY</span>Today's buys</h2>
              <span className="t-eyebrow">{buys.length} names</span>
            </div>
            {buys.length === 0 ? <p style={{ color: 'var(--ink-2)', fontSize: 13, padding: '24px 0' }}>No buys above 80 in latest scan.</p> :
              buys.slice(0, 12).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 0', borderBottom: i < buys.length - 1 ? '1px solid var(--line-0)' : 'none', fontSize: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 18, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', minWidth: 60 }}>{p.ticker || p.symbol}</span>
                    <div style={{ color: 'var(--ink-1)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name || p.security_name}
                      <span style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', display: 'block', marginTop: 2 }}>{p.sector} {p.industry_group ? `· ${p.industry_group}` : ''}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {p.last_price != null && <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 15, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', minWidth: 64, textAlign: 'right' }}>${p.last_price.toFixed(2)}</span>}
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 18, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', minWidth: 32, textAlign: 'right' }}>{p.composite_score || p.score}</span>
                  </div>
                </div>
              ))}
          </div>

          {/* NEARS */}
          <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line-0)', paddingBottom: 14, marginBottom: 14 }}>
              <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}><span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: 'rgba(232,197,118,.16)', color: 'var(--warn)', letterSpacing: '.04em', marginRight: 10 }}>NEAR</span>Near-triggers</h2>
              <span className="t-eyebrow">{nears.length} names</span>
            </div>
            {nears.length === 0 ? <p style={{ color: 'var(--ink-2)', fontSize: 13, padding: '24px 0' }}>No names in the 70-79 band.</p> :
              nears.slice(0, 12).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 0', borderBottom: i < nears.length - 1 ? '1px solid var(--line-0)' : 'none', fontSize: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 18, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', minWidth: 60 }}>{p.ticker || p.symbol}</span>
                    <div style={{ color: 'var(--ink-1)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name || p.security_name}
                      <span style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', display: 'block', marginTop: 2 }}>{p.sector}</span>
                    </div>
                  </div>
                  <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 18, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', minWidth: 32, textAlign: 'right' }}>{p.composite_score || p.score}</span>
                </div>
              ))}
          </div>
        </div>

        {(insider.length > 0 || congress.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, padding: '24px 0 0' }} className="v2-asset-grid">
            {insider.length > 0 && (
              <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line-0)', paddingBottom: 14, marginBottom: 14 }}>
                  <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Insider buys</h2>
                  <span className="t-eyebrow">last 5 trading days · Form 4</span>
                </div>
                {insider.slice(0, 8).map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: i < 7 ? '1px solid var(--line-0)' : 'none', fontSize: 13, gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 15, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', minWidth: 50 }}>{it.ticker || it.symbol}</span>
                      <div style={{ color: 'var(--ink-1)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.insider_name || it.name} · {it.title}
                        <span style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', display: 'block' }}>{it.transaction_date || it.date}</span>
                      </div>
                    </div>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 14, fontFeatureSettings: '"tnum"', color: 'var(--up)' }}>+${it.value_usd ? `${(it.value_usd / 1e6).toFixed(1)}M` : '—'}</span>
                  </div>
                ))}
              </div>
            )}
            {congress.length > 0 && (
              <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 'var(--r-tile)', padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--line-0)', paddingBottom: 14, marginBottom: 14 }}>
                  <h2 className="t-tile" style={{ margin: 0, color: 'var(--ink-0)' }}>Congress activity</h2>
                  <span className="t-eyebrow">last 7 days · STOCK Act</span>
                </div>
                {congress.slice(0, 8).map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: i < 7 ? '1px solid var(--line-0)' : 'none', fontSize: 13, gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 15, color: 'var(--ink-0)', fontFeatureSettings: '"tnum"', minWidth: 50 }}>{it.ticker || it.symbol}</span>
                      <div style={{ color: 'var(--ink-1)', fontSize: 12.5 }}>
                        {it.member} ({it.party || '?'}) · {it.action || it.transaction_type}
                        <span style={{ color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.04em', display: 'block' }}>{it.transaction_date || it.date}</span>
                      </div>
                    </div>
                    <span style={{ fontFamily: 'Inter,system-ui,-apple-system,sans-serif', fontSize: 14, fontFeatureSettings: '"tnum"', color: it.action === 'sale' ? 'var(--down)' : 'var(--up)' }}>{it.amount_range || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ margin: '48px 0 24px', paddingTop: 24, borderTop: '1px solid var(--line-0)', textAlign: 'center', color: 'var(--ink-2)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          scan refreshed 16:30 ET · sources from latest_scan_data.json
        </div>
      </div>

      {err && (
        <div style={{ position: 'fixed', bottom: 16, left: 16, padding: '10px 16px', background: 'var(--bg-1)', border: '1px solid var(--down)', borderRadius: 8, color: 'var(--down)', fontSize: 12 }}>
          Trading Opps: failed to load latest_scan ({err}).
        </div>
      )}
    </div>
  );
}
