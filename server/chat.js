import Anthropic from '@anthropic-ai/sdk';
import { loadProjectConfig } from './project.js';

/**
 * KI-Chatbot für das Dashboard. Beantwortet inhaltsbezogene Fragen anhand der
 * Kennzahlen UND der einzelnen Lead-Datensätze (inkl. Name, E-Mail, Telefon,
 * Fragebogen-Antworten). Rein internes Projekt-Tool.
 */

const MAX_LEAD_ROWS = 400; // so viele Einzel-Leads max. in den Kontext (Token-Budget)

export function isChatConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = 'claude-opus-4-8';

/** Verdichtet das Dashboard-Payload zu einem kompakten, anonymen Kontext. */
export function buildContext(payload, filtered) {
  const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const project = loadProjectConfig();
  const { hasTickets = true, hasQuality = true } = project.features || {};
  const leads = filtered || payload.leads || [];

  const paid = leads.filter((l) => l.sourceType === 'paid');
  const organic = leads.filter((l) => l.sourceType !== 'paid');
  const tickets = leads.filter((l) => l.hasTicket);
  const scored = tickets.filter((l) => l.quality);
  const qualified = tickets.filter((l) => ['A', 'B'].includes(l.quality?.tier));

  // Verteilungen
  const tierDist = {};
  for (const l of scored) tierDist[l.quality.tier] = (tierDist[l.quality.tier] || 0) + 1;

  // Je Dimension verdichten (nur Kennzahlen, keine PII)
  const byDim = (key) => {
    const m = new Map();
    for (const l of leads) {
      const k = l[key] || '(unbekannt)';
      if (!m.has(k)) m.set(k, { name: k, leads: 0 });
      const e = m.get(k);
      e.leads += 1;
      if (hasTickets && l.hasTicket) e.tickets = (e.tickets || 0) + 1;
      if (hasQuality && ['A', 'B'].includes(l.quality?.tier)) e.qualified = (e.qualified || 0) + 1;
    }
    return [...m.values()].sort((a, b) => b.leads - a.leads).slice(0, 25);
  };

  const fb = payload.fb || {};
  const summe = {
    leads_gesamt: leads.length,
    leads_bezahlt: paid.length,
    leads_organisch: organic.length,
    ad_spend_gesamt: round(fb.totals?.spend ?? null),
    ad_spend_lead_kampagnen: round(fb.totals?.leadSpend ?? null),
    ad_spend_traffic: round(fb.totals?.nonLeadSpend ?? null),
    impressionen: fb.totals?.impressions ?? null,
    cpl: fb.totals?.leadSpend && paid.length ? round(fb.totals.leadSpend / paid.length) : null,
  };
  if (hasTickets) {
    summe.vip_tickets = tickets.length;
    summe.kosten_pro_ticket = fb.totals?.leadSpend && tickets.length ? round(fb.totals.leadSpend / tickets.length) : null;
  }
  if (hasQuality) {
    summe.qualifizierte_tickets = qualified.length;
    summe.quali_rate = tickets.length ? round(qualified.length / tickets.length) : null;
  }

  const ctx = {
    zeitraum: payload.range || 'Maximum (gesamter Zeitraum)',
    stand: payload.fetchedAt,
    quelle: payload.source,
    summe,
    ...(hasQuality ? { qualitaets_verteilung_tickets: tierDist } : {}),
    je_kampagne: byDim('campaign'),
    je_anzeigengruppe: byDim('adset'),
    je_creative: byDim('creative'),
    je_placement: byDim('placement'),
  };

  // Einzelne Leads inkl. personenbezogener Daten (internes Tool).
  // Auf MAX_LEAD_ROWS begrenzt, damit der Kontext nicht das Token-Budget sprengt.
  ctx.leads = leads.slice(0, MAX_LEAD_ROWS).map((l) => ({
    name: l.name,
    email: l.email,
    telefon: l.phone,
    lead_am: l.wonAt,
    quelle: l.sourceType,
    kampagne: l.campaign,
    anzeigengruppe: l.adset,
    creative: l.creative,
    placement: l.placement,
    ...(hasTickets ? { vip_am: l.ticketAt, vip_ticket: l.hasTicket } : {}),
    ...(hasQuality ? { quali_score: l.quality?.score ?? null, quali_tier: l.quality?.tier ?? null, antworten: l.answers || null } : {}),
  }));
  if (leads.length > MAX_LEAD_ROWS) {
    ctx.leads_hinweis = `Nur die ersten ${MAX_LEAD_ROWS} von ${leads.length} Leads sind einzeln enthalten; die Summen oben decken alle ab.`;
  }

  // FB-Hierarchie (Kampagnen-Kennzahlen)
  if (Array.isArray(fb.hierarchy)) {
    ctx.facebook_kampagnen = fb.hierarchy.slice(0, 25).map((c) => ({
      name: c.name, aktiv: c.active, traffic: c.leadCampaign === false, funnel: c.funnel || null,
      spend: round(c.spend), leads: c.leads,
      cpl: round(c.cpl), euro_pro_termin: round(c.cptermin), euro_pro_close: round(c.cpclose),
      ...(hasTickets ? { tickets: c.tickets, cpt: round(c.cpt) } : {}),
      ...(hasQuality ? { quali_rate: round(c.qualifiedRate) } : {}),
      cpm: round(c.cpm), ausg_ctr: round(c.outboundCtr), ausg_cpc: round(c.cpoc),
    }));
    // Einzelne Werbeanzeigen (Creatives) für die Ad-Analyse – nach Spend sortiert.
    const creatives = [];
    for (const c of fb.hierarchy) for (const a of c.adsets || []) for (const ad of a.ads || []) {
      creatives.push({
        creative: ad.name, kampagne: c.name, anzeigengruppe: a.name, funnel: c.funnel || null, aktiv: ad.active,
        spend: round(ad.spend), leads: ad.leads, cpl: round(ad.cpl),
        ...(hasQuality ? { quali_rate: round(ad.qualifiedRate) } : {}),
        cvr_start: round(ad.cvrStart), ausg_ctr: round(ad.outboundCtr), ausg_cpc: round(ad.cpoc),
      });
    }
    creatives.sort((x, y) => (y.spend || 0) - (x.spend || 0));
    ctx.top_werbeanzeigen = creatives.slice(0, 40);
  }

  // Lead-Qualität (Umfrage-/Punkte-Modell) – aggregiert, je Ad (UTM Medium).
  if (payload.quality && Array.isArray(payload.quality.rows)) {
    const rows = payload.quality.rows;
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    const byMed = new Map();
    for (const r of rows) {
      if (dist[r.tier] != null) dist[r.tier] += 1;
      const m = byMed.get(r.medium) || { medium: r.medium, gesamt: 0, a: 0, ab: 0, d: 0 };
      m.gesamt += 1;
      if (r.tier === 'A') { m.a += 1; m.ab += 1; } else if (r.tier === 'B') m.ab += 1; else if (r.tier === 'D') m.d += 1;
      byMed.set(r.medium, m);
    }
    const qual = dist.A + dist.B;
    ctx.lead_qualitaet = {
      hinweis: 'Umfrage-basiert (Tier A-D). A/B = qualifiziert, D = KO/disqualifiziert. Betrifft nur den Webinar-Funnel (VSL hat keine Umfrage).',
      bewertet: rows.length,
      verteilung: dist,
      qualifiziert: qual,
      qualifiziert_rate: rows.length ? round(qual / rows.length) : null,
      je_ad: [...byMed.values()].sort((a, b) => b.gesamt - a.gesamt).slice(0, 25)
        .map((m) => ({ ...m, a_quote: m.gesamt ? round(m.a / m.gesamt) : null, ab_quote: m.gesamt ? round(m.ab / m.gesamt) : null })),
    };
  }

  // Funnel-Segmente (z. B. Live/VSL) – Leads je Funnel.
  if (project.funnels?.enabled) {
    const fk = {};
    for (const l of leads) { const f = l.funnel || '(ohne)'; fk[f] = (fk[f] || 0) + 1; }
    ctx.leads_je_funnel = fk;
  }

  // Tagesverlauf (für Fragen zu Schwankungen: CPL/Spend/Leads pro Tag).
  if (Array.isArray(fb.daily?.spend)) {
    const leadByDate = new Map((fb.daily.leads || []).map((d) => [d.date, d.leads]));
    ctx.verlauf_pro_tag = fb.daily.spend.map((d) => {
      const l = leadByDate.get(d.date) || 0;
      return { tag: d.date, ad_spend: round(d.spend), leads: l, cpl: l ? round(d.spend / l) : null };
    });
    ctx.verlauf_hinweis = 'ad_spend = Konto-Tages-Spend (alle Kampagnen), leads = Sheet-Leads des Tages, cpl = ad_spend ÷ leads. Für CPL-Schwankungen diese Tagesreihe nutzen.';
  }
  return ctx;
}

/** Baut den System-Prompt abhängig von den aktiven Features des Projekts. */
function buildSystemPrompt(project) {
  const { hasTickets = true, hasQuality = true } = project.features || {};
  const themen = ['Werbe-Performance', hasQuality && 'Lead-Qualität'].filter(Boolean).join(' und ');
  const lines = [
    `Du bist der Analyse-Assistent im Lead-Dashboard für "${project.name}".`,
    `Du beantwortest Fragen zu ${themen} auf Basis der dir gelieferten, bereits aggregierten Kennzahlen.`,
    '',
    'Regeln:',
    '- Antworte kurz, präzise und auf Deutsch. Nutze konkrete Zahlen aus dem Kontext.',
    '- Rechne bei Bedarf abgeleitete Werte (z. B. Verhältnisse) sauber aus den vorhandenen Zahlen.',
    '- Beträge in Euro mit € und Tausenderpunkt; Raten in Prozent.',
    '- Wenn eine Zahl nicht im Kontext steht, sag das klar – erfinde nichts.',
    '- Der Kontext bezieht sich auf den aktuell im Dashboard gewählten Zeitraum/Filter.',
  ];
  if (hasQuality) {
    lines.push('- Lead-Qualität: Tier A/B = qualifiziert, D = disqualifiziert (KO). Das Scoring stammt aus dem Fragebogen ("Umfrage"); nutze die gelieferten Tiers/Verteilungen in "lead_qualitaet" (auch je Ad), erfinde keine Scoring-Regeln.');
  }
  lines.push(
    `- Dir liegen auch die einzelnen Leads inkl. Name, E-Mail, Telefon${hasQuality ? ' und Fragebogen-Antworten' : ''} vor (internes Tool). Du darfst daraus konkrete Personen nennen, Listen erstellen und Kontaktdaten ausgeben, wenn danach gefragt wird.`,
    "- Das Feld 'leads' enthält ggf. nur die ersten N Datensätze (siehe leads_hinweis); für Gesamtzahlen nutze die Summen/Verdichtungen.",
    '- Formatiere Vergleiche/Ranglisten/Lead-Listen als kurze Aufzählung oder Tabelle, wenn es hilft.'
  );
  return lines.join('\n');
}

/**
 * Beantwortet eine Chat-Nachricht. messages = [{role, content}], history-fähig.
 * Der aggregierte Kontext wird als cache-fähiger Block vorangestellt.
 */
export async function chat({ messages, context }) {
  if (!isChatConfigured()) {
    throw new Error('Chatbot nicht konfiguriert (ANTHROPIC_API_KEY fehlt).');
  }
  const client = new Anthropic();

  const system = [
    { type: 'text', text: buildSystemPrompt(loadProjectConfig()) },
    {
      type: 'text',
      // Kontext als eigener Block, gecacht – stabil über die Konversation
      text: `Aktuelle Dashboard-Kennzahlen (aggregiert, anonym) als JSON:\n${JSON.stringify(context)}`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const response = await client.messages.create({
    model: MODEL,
    // Großzügiges Budget: "adaptive thinking" braucht Platz, sonst bleibt bei
    // tiefen Analysefragen kein Token mehr für die eigentliche Antwort übrig.
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system,
    messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  });

  const text = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (text) return text;
  if (response.stop_reason === 'max_tokens') {
    return 'Die Antwort wurde abgeschnitten (Frage sehr umfangreich). Bitte etwas gezielter fragen – z. B. nach einer konkreten Kennzahl, einer Kampagne/Anzeige oder einem bestimmten Zeitraum.';
  }
  return 'Dazu habe ich keine Antwort.';
}
