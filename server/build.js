import { computeQuality } from './scoring.js';
import { loadCampaignConfig } from './campaigns.js';
import { DEFAULT_PROJECT } from './project.js';
import { activeFunnels, funnelForRecord } from './funnels.js';

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Rein numerischer Wert (z. B. Meta-IDs wie 52540202640549) -> nicht zuordenbar. */
const isNumericId = (s) => /^\d{6,}$/.test(collapse(s));

const titleCase = (s) => collapse(s).replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Aussagekräftiges Label für eine ORGANISCHE Quelle:
 * - ManyChat (steht im utm_medium) -> "ManyChat · <Kampagnenname>"
 * - Bio (utm_source enthält "bio")  -> "<Plattform> Bio"  (fb-bio -> Facebook Bio)
 * - sonst -> die Quelle selbst (Title Case)
 * Liefert { campaign, adset } für die zweistufige Gruppierung.
 */
function organicLabels(utm) {
  const src = collapse(utm.source).toLowerCase();
  const med = collapse(utm.medium).toLowerCase();
  const camp = collapse(utm.campaign);

  if (/manychat/.test(med) || /manychat/.test(src) || /manychat/.test(camp.toLowerCase())) {
    const flow = camp || titleCase(collapse(utm.medium).replace(/manychat/i, '').replace(/[-_|]/g, ' ').trim()) || '(ohne Flow)';
    return { campaign: 'ManyChat', adset: flow };
  }
  if (/bio/.test(src)) {
    const platMap = { fb: 'Facebook', facebook: 'Facebook', ig: 'Instagram', insta: 'Instagram', instagram: 'Instagram', yt: 'YouTube', youtube: 'YouTube', tiktok: 'TikTok', tt: 'TikTok' };
    const token = src.replace(/[-_\s]*bio.*/, '').replace(/[-_\s]+/g, '');
    const plat = platMap[token] || titleCase(token) || 'Bio';
    return { campaign: 'Bio', adset: `${plat} Bio` };
  }
  const label = titleCase(src) || '(direkt)';
  return { campaign: label, adset: label };
}

/** Lesbares Label für ein Placement (utm_term). */
function placementLabel(term) {
  const t = collapse(term);
  if (!t) return '(kein Placement)';
  if (/^\d{6,}$/.test(t)) return `Placement-ID ${t}`;
  return t.replace(/_/g, ' ');
}

/** Quellen, die immer als organisch gelten – unabhängig vom UTM-Schema. */
function isOrganicSource(utm, patterns) {
  const hay = [utm.source, utm.medium, utm.campaign, utm.term]
    .map((v) => collapse(v).toLowerCase())
    .join(' | ');
  return patterns.some((p) => hay.includes(String(p).toLowerCase()));
}

/**
 * Entscheidet, ob ein Datensatz aus bezahlter Werbung stammt.
 * Bezahlte Anzeigengruppen folgen dem Schema "X | Y | Z | ..." und/oder
 * tauchen in der Adspend-Übersicht auf. Alles andere gilt als organisch.
 */
function isPaid(utm, paidAdsets, organicPatterns, paidPatterns) {
  // Expliziter Paid-Marker (aus campaigns.json) hat Vorrang – nötig, wenn
  // bezahlte Anzeigengruppen NICHT dem "X | Y | Z"-Schema folgen (z. B.
  // "CBO AG2: …") und der Kampagnenname zufällig ein Organisch-Wort enthält.
  if (isOrganicSource(utm, paidPatterns)) return true;
  // Harte Regel: ManyChat / Bio / Newsletter etc. ist immer organisch.
  if (isOrganicSource(utm, organicPatterns)) return false;
  const src = collapse(utm.source);
  if (!src) return false;
  if (paidAdsets.has(src.toLowerCase())) return true;
  // Bezahlte Anzeigengruppen folgen oft dem Schema "X | Y | Z | ...".
  if (src.includes('|')) return true;
  // Rein numerische Source = Meta-ID -> bezahlt (aber nicht eindeutig zuordenbar).
  if (isNumericId(src)) return true;
  return false;
}

/**
 * Leitet Kampagne/Anzeigengruppe/Creative aus den UTM-Werten ab (gleiche Logik
 * wie bei den Leads): organisch -> Sammel-Label, paid mit unvollständigem Tagging
 * -> Sammel-Bucket, sonst die Rohwerte.
 */
function classifyUtm(utm, paid, organicLabel, unattribLabel) {
  const rawCampaign = collapse(utm.campaign);
  const rawAdset = collapse(utm.source);
  const rawCreative = collapse(utm.medium);
  if (!paid) return { campaign: organicLabel, adset: organicLabel, creative: rawCreative || organicLabel };
  if (isNumericId(rawCampaign) || isNumericId(rawAdset) || !rawCampaign || !rawAdset) {
    return { campaign: unattribLabel, adset: unattribLabel, creative: rawCreative || unattribLabel };
  }
  return { campaign: rawCampaign, adset: rawAdset, creative: rawCreative || unattribLabel };
}

/**
 * Führt Leads, VIP-Tickets und Adspend-Übersicht zu einem einheitlichen
 * Datensatz zusammen. Join über die E-Mail-Adresse.
 */
export function buildDataset({ leads, tickets, overview, termine = [], closings = [], closingsSummary = null }, cfg, project = DEFAULT_PROJECT) {
  const warnings = [];
  const { hasTickets = true, hasQuality = true } = project.features || {};
  // Fragebogen-Modus "criteria" (Nicole): die Umfrage-Zeilen sind ihre eigene
  // Auswertungseinheit (eigenes Datum + UTM Medium) und werden NICHT mit dem
  // Leads-Tab verknüpft. Kein Per-Lead-Score, keine Umfrage-Zeilen als Leads.
  const surveyMode = hasQuality && (cfg?.model === 'criteria' || cfg?.model === 'points');
  const funnels = activeFunnels(project); // Segmentierung Live/VSL (oder null)
  const paidAdsets = new Set(overview.map((o) => o.adset.toLowerCase()));
  const campCfg = loadCampaignConfig();
  const organicPatterns = campCfg.organicPatterns || ['manychat', 'bio'];
  const paidPatterns = campCfg.paidPatterns || [];
  const organicLabel = campCfg.organicLabel || '(organisch)';
  const unattribLabel = campCfg.unattributablePaidLabel || '(Paid · nicht zuordenbar)';

  // Antworten/Qualität aus dem VIP-Tab nach E-Mail indizieren (zum Anreichern
  // der Lead-Zeilen; verändert NICHT die Lead-Anzahl).
  const ticketByEmail = new Map();
  for (const t of tickets) {
    for (const e of [t.email, t.emailTypeform]) {
      if (e && !ticketByEmail.has(e)) ticketByEmail.set(e, t);
    }
  }

  // 1) Jede Lead-Zeile = ein Datensatz (KEIN Dedup, auch ohne E-Mail). Damit
  //    entspricht die Lead-Anzahl exakt den Zeilen im Sheet.
  const recs = [];
  const seenLeadEmails = new Set();
  for (const l of leads) {
    const email = l.email || '';
    if (email) seenLeadEmails.add(email);
    const t = (!surveyMode && email) ? ticketByEmail.get(email) : null;
    recs.push({
      email,
      firstName: l.firstName || t?.firstName || '',
      lastName: l.lastName || t?.lastName || '',
      phone: t?.phone || '',
      wonAt: l.wonAt,
      // hasTicket pro Zeile zuverlässig aus der "VIP-Ticket geholt am"-Spalte
      // (nur wenn das Projekt überhaupt Tickets kennt – sonst immer false).
      ticketAt: l.ticketAt || null,
      hasTicket: hasTickets && Boolean(l.ticketAt),
      utm: collapse(l.utm.source) ? { ...l.utm } : (t ? { ...t.utm } : { ...l.utm }),
      answers: t?.answers || null,
      tabTitle: l.tabTitle || '',
    });
  }

  // 2) VIP-Tickets, deren E-Mail in KEINER Lead-Zeile vorkommt, als eigene
  //    Datensätze ergänzen (z. B. nur im VIP-Tab erfasste Personen).
  for (const t of (surveyMode ? [] : tickets)) {
    // mit einer Lead-Zeile verknüpft? (beide Mail-Varianten prüfen)
    if ((t.email && seenLeadEmails.has(t.email)) || (t.emailTypeform && seenLeadEmails.has(t.emailTypeform))) continue;
    const email = t.email || t.emailTypeform || '';
    recs.push({
      email,
      firstName: t.firstName || '',
      lastName: t.lastName || '',
      phone: t.phone || '',
      wonAt: t.at || null,
      ticketAt: t.at || null,
      hasTicket: hasTickets,
      utm: { ...t.utm },
      answers: t.answers || null,
    });
  }

  // 3) Finalisieren: Dimensionen, Quelle, Qualität
  const records = [];
  for (const r of recs) {
    const paid = isPaid(r.utm, paidAdsets, organicPatterns, paidPatterns);
    // Per-Lead-Qualität nur im gewichteten Modell. Im criteria-Modus (Nicole)
    // ist die Umfrage die eigene Einheit -> siehe qualitySummary weiter unten.
    const quality = (hasQuality && !surveyMode) ? computeQuality(r.answers, cfg) : null;

    // Dimensions-Labels je nach Quelle/Zuordenbarkeit:
    // - organisch: alles unter einem Sammel-Label zusammenfassen
    // - paid, aber Name = reine Meta-ID (nicht zuordenbar): Sammel-Bucket
    const rawCampaign = collapse(r.utm.campaign);
    const rawAdset = collapse(r.utm.source);
    const rawCreative = collapse(r.utm.medium);
    let campaign, adset, creative;
    if (!paid) {
      campaign = organicLabel;
      adset = organicLabel;
      creative = rawCreative || organicLabel;
    } else if (isNumericId(rawCampaign) || isNumericId(rawAdset) || !rawCampaign || !rawAdset) {
      // Paid, aber Tagging unvollständig (Meta-ID ODER Kampagne/Anzeigengruppe
      // fehlt) -> in den Sammel-Bucket statt einer verwirrenden (unbekannt)-Zeile.
      campaign = unattribLabel;
      adset = unattribLabel;
      creative = rawCreative || unattribLabel;
    } else {
      campaign = rawCampaign;
      adset = rawAdset;
      creative = rawCreative || unattribLabel;
    }

    records.push({
      email: r.email,
      name: collapse(`${r.firstName} ${r.lastName}`) || '(ohne Name)',
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone,
      wonAt: r.wonAt,
      ticketAt: r.ticketAt,
      hasTicket: r.hasTicket,
      sourceType: paid ? 'paid' : 'organic',
      funnel: funnelForRecord(funnels, r.tabTitle, r.utm),
      campaign,
      adset,
      creative,
      placement: placementLabel(r.utm.term),
      placementRaw: collapse(r.utm.term),
      // Rohe UTM-Werte für den Quellen-Tab (Donut/Top-Listen)
      sourceRaw: collapse(r.utm.source),
      campaignRaw: collapse(r.utm.campaign),
      mediumRaw: collapse(r.utm.medium),
      // Aussagekräftige Gruppierung für den Organisch-Container
      ...(paid ? {} : (() => { const o = organicLabels(r.utm); return { organicCampaign: o.campaign, organicAdset: o.adset }; })()),
      quality,
      answers: r.answers,
    });
  }

  // Spend-Übersicht: nach Anzeigengruppe verdichten (mehrere Kampagnen-Tabs)
  const overviewByAdset = new Map();
  for (const o of overview) {
    const k = o.adset.toLowerCase();
    if (!overviewByAdset.has(k)) overviewByAdset.set(k, o);
  }

  const matchedAdsets = new Set(records.filter((r) => r.sourceType === 'paid').map((r) => r.adset.toLowerCase()));
  for (const o of overview) {
    if (!matchedAdsets.has(o.adset.toLowerCase())) {
      // Übersicht kennt eine Anzeigengruppe, zu der (noch) keine Leads mit
      // exakt gleichem utm_source gefunden wurden – nur ein Hinweis.
    }
  }

  // Funnel-Stufe "Termine": jede Zeile mit Gesprächs-Datum = ein vereinbarter
  // Termin. Quelle/Attribution analog zu den Leads (über dieselben UTM-Regeln).
  const termineRecords = (termine || []).map((t) => {
    const paid = isPaid(t.utm, paidAdsets, organicPatterns, paidPatterns);
    const { campaign, adset, creative } = classifyUtm(t.utm, paid, organicLabel, unattribLabel);
    return {
      name: collapse(t.name) || '(ohne Name)',
      email: t.email,
      phone: t.phone,
      wonAt: t.wonAt,
      appointmentAt: t.appointmentAt,
      sourceType: paid ? 'paid' : 'organic',
      funnel: funnelForRecord(funnels, t.tabTitle, t.utm),
      campaign,
      adset,
      creative,
    };
  });

  // Funnel-Stufe "Closings" (Verkäufe): je Zeile ein Verkauf inkl. Umsatz,
  // Quelle/Attribution analog zu Leads/Termine.
  const closingRecords = (closings || []).map((c) => {
    const paid = isPaid(c.utm, paidAdsets, organicPatterns, paidPatterns);
    const { campaign, adset, creative } = classifyUtm(c.utm, paid, organicLabel, unattribLabel);
    return {
      name: collapse(c.name) || '(ohne Name)',
      email: c.email,
      phone: c.phone,
      land: c.land,
      produkt: c.produkt,
      revenueNet: c.revenueNet,
      revenueGross: c.revenueGross,
      cashCollectNet: c.cashCollectNet,
      cashCollectGross: c.cashCollectGross,
      wonAt: c.wonAt,
      sourceType: paid ? 'paid' : 'organic',
      funnel: funnelForRecord(funnels, c.tabTitle, c.utm),
      campaign,
      adset,
      creative,
    };
  });

  // Lead-Qualität (criteria-Modell): jede Umfrage-Zeile ab validFrom bewerten.
  // Datenbasis = die Umfrage selbst (eigenes Datum + UTM Medium). Der Client
  // aggregiert daraus Verteilung/Tagestrend/Ad-Breakdown (zeitraumabhängig).
  let qualitySummary = null;
  if (surveyMode) {
    const validFrom = cfg.validFrom || null;
    const rows = [];
    for (const t of tickets) {
      const day = (t.at || '').slice(0, 10);
      if (!day) continue;
      if (validFrom && day < validFrom) continue; // nur ab Stichtag bewerten
      const q = computeQuality(t.answers, cfg);
      if (!q) continue;
      // Attribution über das volle UTM des Fragebogens (wie bei den Leads) –
      // ermöglicht die Quali-Aufschlüsselung je Kampagne/Anzeigengruppe/Creative.
      const paid = isPaid(t.utm, paidAdsets, organicPatterns, paidPatterns);
      const { campaign, adset, creative } = classifyUtm(t.utm, paid, organicLabel, unattribLabel);
      rows.push({
        day,
        tier: q.tier,
        medium: collapse(t.utmMedium) || '(kein Medium)',
        sourceType: paid ? 'paid' : 'organic',
        funnel: funnelForRecord(funnels, t.tabTitle, t.utm),
        campaign,
        adset,
        creative,
      });
    }
    qualitySummary = { validFrom, tiers: cfg.tiers || [], rows };
  }

  return {
    leads: records,
    quality: qualitySummary,
    overview,
    overviewByAdset: Object.fromEntries(overviewByAdset),
    termine: termineRecords,
    closings: closingRecords,
    // Cash Collect existiert im Sheet nur als Gesamtsumme (nicht je Verkauf).
    closingsSummary: closingsSummary
      ? {
          cashCollect: (closingsSummary.cashCollectPaid || 0) + (closingsSummary.cashCollectOrganisch || 0),
          cashCollectPaid: closingsSummary.cashCollectPaid ?? null,
          cashCollectOrganisch: closingsSummary.cashCollectOrganisch ?? null,
          umsatzPaid: closingsSummary.umsatzPaid ?? null,
          umsatzOrganisch: closingsSummary.umsatzOrganisch ?? null,
          closingsCount: closingsSummary.closingsCount ?? null,
        }
      : null,
    warnings,
    counts: {
      leads: records.length,
      paidLeads: records.filter((r) => r.sourceType === 'paid').length,
      tickets: records.filter((r) => r.hasTicket).length,
      scored: records.filter((r) => r.quality).length,
      termine: termineRecords.length,
      paidTermine: termineRecords.filter((r) => r.sourceType === 'paid').length,
      closings: closingRecords.length,
      paidClosings: closingRecords.filter((r) => r.sourceType === 'paid').length,
    },
  };
}
