import React from 'react';
import { fmtInt } from '../lib.js';

/**
 * Funnel-Umschalter (Gesamt · Live · VSL). Filtert das gesamte Dashboard auf
 * das gewählte Segment. counts = Lead-Anzahl je Segment (inkl. 'all' = Gesamt).
 */
export default function SegmentSwitcher({ segments = [], segment, onChange, counts = {} }) {
  const items = [{ key: 'all', label: 'Gesamt' }, ...segments];
  return (
    <div className="seg-switch" role="tablist" aria-label="Funnel-Segment">
      {items.map((s) => (
        <button
          key={s.key}
          role="tab"
          aria-selected={segment === s.key}
          className={`seg-pill ${segment === s.key ? 'active' : ''}`}
          onClick={() => onChange(s.key)}
        >
          <span className="seg-label">{s.label}</span>
          <span className="seg-count">{fmtInt(counts?.[s.key] ?? 0)}</span>
        </button>
      ))}
    </div>
  );
}
