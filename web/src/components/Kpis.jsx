import React from 'react';
import { fmtEur, fmtInt, fmtPct } from '../lib.js';

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

const CYAN = '#5ec8d8';
const GREEN = '#6fcf97';
const VIOLET = '#a78bfa';

export default function Kpis({ kpis, dist, tiers, features = {}, accent = '#d0bb5a', ticketLabel = {}, termine = {}, closings = {} }) {
  const { hasTickets = true, hasQuality = true } = features;
  const tPlural = ticketLabel.plural || 'VIP-Tickets';

  return (
    <div className="kpi-sections">
      {/* Bezahlt (Facebook Ads) */}
      <section className="kpi-section">
        <div className="kpi-section-head"><span className="kpi-dot" style={{ background: accent }} />Bezahlt · Facebook Ads</div>
        <div className="kpi-grid">
          <Card label="Adspend" value={fmtEur(kpis.spend)} sub={kpis.nonLeadSpend > 0 ? `davon ${fmtEur(kpis.nonLeadSpend)} Traffic` : 'gesamt'} accent={accent} />
          <Card label="Bezahlte Leads" value={fmtInt(kpis.paid)} sub="über Ads" accent={accent} />
          <Card label="CPL" value={fmtEur(kpis.cpl)} sub={kpis.nonLeadSpend > 0 ? 'nur Lead-Kampagnen' : 'pro bezahltem Lead'} accent={accent} />
          {hasTickets && <Card label={`${tPlural} (Paid)`} value={fmtInt(kpis.paidTickets)} sub={`Rate ${fmtPct(kpis.paidTicketRate)}`} accent={accent} />}
          {hasTickets && <Card label="Kosten / Ticket" value={fmtEur(kpis.cpt)} sub="pro bezahltem Ticket" accent={accent} />}
        </div>
      </section>

      {/* Organisch */}
      <section className="kpi-section">
        <div className="kpi-section-head"><span className="kpi-dot" style={{ background: CYAN }} />Organisch</div>
        <div className="kpi-grid">
          <Card label="Organische Leads" value={fmtInt(kpis.organic)} sub="ohne Ad-Kosten" accent={CYAN} />
          {hasTickets && <Card label={`${tPlural} (Organisch)`} value={fmtInt(kpis.organicTickets)} sub={`Rate ${fmtPct(kpis.organicTicketRate)}`} accent={CYAN} />}
          <Card label="Leads gesamt" value={fmtInt(kpis.total)} sub={`${fmtInt(kpis.paid)} bezahlt · ${fmtInt(kpis.organic)} organisch`} accent={CYAN} />
        </div>
      </section>

      {/* Termine (Funnel-Stufe nach den Leads) */}
      {termine.has && (
        <section className="kpi-section">
          <div className="kpi-section-head"><span className="kpi-dot" style={{ background: VIOLET }} />Termine</div>
          <div className="kpi-grid">
            <Card label="Termine gesamt" value={fmtInt(termine.total)} sub="vereinbarte Gespräche" accent={VIOLET} />
            <Card label="Termine über Ads" value={fmtInt(termine.paid)} sub="bezahlt" accent={VIOLET} />
            <Card label="Termine organisch" value={fmtInt(termine.organic)} sub="ohne Ad-Kosten" accent={VIOLET} />
          </div>
        </section>
      )}

      {/* Closings (Verkäufe + Umsatz) */}
      {closings.has && (
        <section className="kpi-section">
          <div className="kpi-section-head"><span className="kpi-dot" style={{ background: GREEN }} />Closings</div>
          <div className="kpi-grid">
            <Card label="Closings gesamt" value={fmtInt(closings.total)} sub={`${fmtInt(closings.paid)} über Ads · ${fmtInt(closings.organic)} organisch`} accent={GREEN} />
            <Card label="Cash Collect netto" value={fmtEur(closings.ccNetto)} sub={`${fmtEur(closings.ccNettoPaid)} über Ads · ${fmtEur(closings.ccNettoOrganic)} organisch`} accent={GREEN} />
            <Card label="Cash Collect brutto" value={fmtEur(closings.ccBrutto)} sub={`${fmtEur(closings.ccBruttoPaid)} über Ads · ${fmtEur(closings.ccBruttoOrganic)} organisch`} accent={GREEN} />
            <Card label="Umsatz netto" value={fmtEur(closings.netto)} sub={`${fmtEur(closings.nettoPaid)} über Ads · ${fmtEur(closings.nettoOrganic)} organisch`} accent={GREEN} />
            <Card label="Umsatz brutto" value={fmtEur(closings.brutto)} sub={`${fmtEur(closings.bruttoPaid)} über Ads · ${fmtEur(closings.bruttoOrganic)} organisch`} accent={GREEN} />
          </div>
        </section>
      )}

      {/* Lead-Qualität (quellenübergreifend) */}
      {hasQuality && (
        <section className="kpi-section">
          <div className="kpi-section-head"><span className="kpi-dot" style={{ background: GREEN }} />Lead-Qualität</div>
          <div className="kpi-grid">
            <Card label="Qualifizierte Leads" value={fmtPct(kpis.qualifiedRate)} sub={`Tier A/B der ${tPlural}`} accent={GREEN} />
            <Card label="Qualifizierte Leads" value={fmtInt(kpis.qualified)} sub={`von ${fmtInt(kpis.tickets)} ${tPlural}`} accent={GREEN} />
            <div className="kpi-card kpi-dist">
              <div className="kpi-label">Qualitäts-Verteilung (Tickets)</div>
              <div className="dist-bars">
                {tiers.map((t) => (
                  <div key={t.key} className="dist-row">
                    <span className="dist-key" style={{ color: t.color }}>{t.key}</span>
                    <div className="dist-track">
                      <div className="dist-fill" style={{ width: `${kpis.tickets ? (dist[t.key] / kpis.tickets) * 100 : 0}%`, background: t.color }} />
                    </div>
                    <span className="dist-count">{dist[t.key] || 0}</span>
                  </div>
                ))}
                {dist.none > 0 && (
                  <div className="dist-row">
                    <span className="dist-key muted">–</span>
                    <div className="dist-track"><div className="dist-fill" style={{ width: `${kpis.tickets ? (dist.none / kpis.tickets) * 100 : 0}%`, background: '#94a3b8' }} /></div>
                    <span className="dist-count">{dist.none}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
