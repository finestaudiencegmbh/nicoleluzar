import React, { useMemo } from 'react';
import { fmtInt, fmtPct } from '../lib.js';
import TimeChart from './TimeChart.jsx';

const GREEN = '#6fcf97';

function Card({ label, value, sub, accent }) {
  return (
    <div className="kpi-card">
      <span className="kpi-accent" style={accent ? { background: accent, color: accent } : undefined} />
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

const inRange = (day, from, to) => (!from || day >= from) && (!to || day <= to);

/**
 * Lead-Qualität (criteria-Modell, Nicole). Rechnet aus den bewerteten Umfrage-
 * Zeilen (data.quality.rows = {day, tier, medium}) die Kennzahlen – zeitraum-
 * abhängig (Datepicker) und immer erst ab dem Stichtag (serverseitig gefiltert).
 */
export default function QualityView({ quality, range = {}, accent = '#d0bb5a' }) {
  const tiers = quality?.tiers || [];
  const rows = useMemo(
    () => (quality?.rows || []).filter((r) => inRange(r.day, range.from, range.to)),
    [quality, range.from, range.to]
  );

  const { dist, total, qualified, qualifiedRate, daily, byMedium } = useMemo(() => {
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    const dayMap = new Map();
    const medMap = new Map();
    for (const r of rows) {
      if (dist[r.tier] != null) dist[r.tier] += 1;
      const isQual = r.tier === 'A' || r.tier === 'B';
      const d = dayMap.get(r.day) || { total: 0, qualified: 0 };
      d.total += 1; if (isQual) d.qualified += 1; dayMap.set(r.day, d);
      const m = medMap.get(r.medium) || { total: 0, a: 0, ab: 0, d: 0 };
      m.total += 1;
      if (r.tier === 'A') { m.a += 1; m.ab += 1; } else if (r.tier === 'B') m.ab += 1; else if (r.tier === 'D') m.d += 1;
      medMap.set(r.medium, m);
    }
    const total = rows.length;
    const qualified = dist.A + dist.B;
    const daily = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, v]) => ({ date: day, value: v.total ? (v.qualified / v.total) * 100 : 0 }));
    const byMedium = [...medMap.entries()].map(([medium, v]) => ({ medium, ...v })).sort((a, b) => b.total - a.total);
    return { dist, total, qualified, qualifiedRate: total ? qualified / total : null, daily, byMedium };
  }, [rows]);

  if (!quality) return null;

  return (
    <>
      <section className="panel">
        <div className="panel-head"><div><h2>Lead-Qualität</h2><span className="panel-sub">Fragebogen „Umfrage NEU" · bewertet ab {quality.validFrom} · {fmtInt(total)} Leads im Zeitraum</span></div></div>
        <div className="kpi-grid">
          <Card label="Qualifizierte Leads" value={fmtPct(qualifiedRate)} sub="Tier A + B" accent={GREEN} />
          <Card label="Qualifizierte Leads" value={fmtInt(qualified)} sub={`von ${fmtInt(total)} bewerteten`} accent={GREEN} />
          <div className="kpi-card kpi-dist">
            <div className="kpi-label">Qualitäts-Verteilung</div>
            <div className="dist-bars">
              {tiers.map((t) => (
                <div key={t.key} className="dist-row">
                  <span className="dist-key" style={{ color: t.color }}>{t.key}</span>
                  <div className="dist-track"><div className="dist-fill" style={{ width: `${total ? (dist[t.key] / total) * 100 : 0}%`, background: t.color }} /></div>
                  <span className="dist-count">{dist[t.key] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Lead-Qualität pro Tag</h2><span className="panel-sub">Anteil qualifizierter Leads (A+B) je Tag</span></div></div>
        <TimeChart title="Qualifizierte Leads" formatY={(v) => `${Math.round(v)} %`}
          series={[{ key: 'quali', label: 'Qualifiziert (A+B)', color: GREEN, data: daily }]} />
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Nach Ad (UTM Medium)</h2><span className="panel-sub">Qualität je Anzeige/Quelle · sortiert nach Lead-Zahl</span></div></div>
        <div className="qtable-wrap">
          <table className="qtable">
            <thead>
              <tr><th className="qt-name">UTM Medium</th><th>Leads</th><th>A</th><th>A-Quote</th><th>A+B-Quote</th><th>D</th></tr>
            </thead>
            <tbody>
              {byMedium.map((m) => (
                <tr key={m.medium}>
                  <td className="qt-name" title={m.medium}>{m.medium}</td>
                  <td>{fmtInt(m.total)}</td>
                  <td>{fmtInt(m.a)}</td>
                  <td>{fmtPct(m.total ? m.a / m.total : null)}</td>
                  <td>{fmtPct(m.total ? m.ab / m.total : null)}</td>
                  <td>{fmtInt(m.d)}</td>
                </tr>
              ))}
              {byMedium.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: '14px 2px' }}>Keine bewerteten Leads im Zeitraum.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
