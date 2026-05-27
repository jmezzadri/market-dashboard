import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Stub from './_Stub';

export default function TickerPage() {
  const { symbol } = useParams();
  const nav = useNavigate();
  return (
    <div className="mt-pagebody mt-fade">
      <div style={{ padding: '18px var(--mt-pad-page) 0' }}>
        <button type="button" className="mt-btn mt-btn--ghost" onClick={() => nav(-1)}>
          ← Back
        </button>
      </div>
      <Stub
        eyebrow={symbol?.toUpperCase() || 'Ticker'}
        title={{ before: 'Ticker detail for ', after: '.' }}
        accent={symbol?.toUpperCase() || ''}
        deck="Monumental symbol header · MacroTilt score card · price history with overlays · key-stats grid · tabs for score / insider / options / dark / news / fundamentals · related names."
      />
    </div>
  );
}
