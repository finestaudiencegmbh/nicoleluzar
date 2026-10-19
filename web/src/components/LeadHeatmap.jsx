import React, { useMemo } from 'react';
import { fmtInt } from '../lib.js';

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const pad = (n) => String(n).padStart(2, '0');

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 236, g: 118, b: 30 };
}

/**
 * Heatmap der Lead-Eingänge nach Wochentag × Uhrzeit. Zeit = wie im Sheet
 * (UTC-Komponenten des Zeitstempels, konsistent zur restlichen Anzeige).
 */
export default function LeadHeatmap({ leads = [], accent = '#ec761e' }) {
  const { grid, max, best, total } = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let total = 0;
    for (const l of leads) {
      if (!l.wonAt) continue;
      const d = new Date(l.wonAt);
      if (Number.isNaN(d.getTime())) continue;
      const wd = (d.getUTCDay() + 6) % 7; // 0=Mo … 6=So
      grid[wd][d.getUTCHours()] += 1;
      total += 1;
    }
    let max = 0;
    let best = null;
    for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) {
      const v = grid[w][h];
      if (v > max) max = v;
      if (v > 0 && (!best || v > best.v)) best = { w, h, v };
    }
    return { grid, max, best, total };
  }, [leads]);

  const { r, g, b } = hexToRgb(accent);
  const cellColor = (v) => (v === 0 || max === 0 ? 'rgba(255,255,255,0.035)' : `rgba(${r},${g},${b},${0.16 + 0.84 * (v / max)})`);
  const legend = [0.2, 0.4, 0.6, 0.85, 1].map((a) => `rgba(${r},${g},${b},${a})`);

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Leadaktivitäten</h2><span className="panel-sub">Eingänge nach Wochentag und Uhrzeit · Zeit wie im Sheet</span></div>
        {best && (
          <div className="hm-best">Stärkstes Fenster: <b style={{ color: accent }}>{DAYS_LONG[best.w]}, {best.h}–{(best.h + 1) % 24} Uhr</b> · {fmtInt(best.v)} Leads</div>
        )}
      </div>
      <div className="hm-wrap">
        <div className="hm-grid">
          <div />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={`hl${h}`} className="hm-hourlabel">{h % 3 === 0 ? h : ''}</div>
          ))}
          {DAYS.map((day, w) => (
            <React.Fragment key={day}>
              <div className="hm-daylabel">{day}</div>
              {Array.from({ length: 24 }).map((_, h) => (
                <div
                  key={`${w}-${h}`}
                  className="hm-cell"
                  style={{ background: cellColor(grid[w][h]) }}
                  title={`${DAYS_LONG[w]} ${pad(h)}–${pad((h + 1) % 24)} Uhr · ${grid[w][h]} Leads`}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
        <div className="hm-legend">
          <span>wenig</span>
          {legend.map((c, i) => (<span key={i} className="hm-swatch" style={{ background: c }} />))}
          <span>viel</span>
        </div>
      </div>
      {total === 0 && <div className="muted" style={{ padding: '8px 2px' }}>Keine Leads im gewählten Zeitraum/Segment.</div>}
    </section>
  );
}
