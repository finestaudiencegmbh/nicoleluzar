import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'project.config.json');

/**
 * Eingebaute Defaults = das ursprüngliche (MoneyMaker-)Verhalten: beide Features
 * an, vollständiges Fragebogen-Mapping. Sie werden verwendet, wenn keine Config
 * übergeben wird (z. B. in den Tests) oder die Datei fehlt. Der Server (index.js)
 * injiziert die echte config/project.config.json über loadProjectConfig().
 */
export const DEFAULT_PROJECT = {
  name: 'Lead-Dashboard',
  shortName: 'Dashboard',
  subtitle: '',
  branding: { accent: '#d0bb5a', logo: '/logo.svg' },
  features: { hasTickets: true, hasQuality: true },
  ticketLabel: { singular: 'VIP-Ticket', plural: 'VIP-Tickets' },
  // Sheet-Tabellen-Erkennung + Spalten-Mapping. Schlüssel sind normalisiert
  // (kleingeschrieben, ohne ? : ., Mehrfach-Leerzeichen kollabiert). Pro Feld
  // mehrere Varianten erlaubt (erste nicht-leere gewinnt). Defaults = bisheriges
  // (MoneyMaker-)Verhalten, sodass die Tests ohne Config grün bleiben.
  sheet: {
    overview: {
      detect: { all: ['anzeigengruppe', 'adspend'], any: [] },
      fields: {
        key: ['anzeigengruppe', 'creative'],
        status: ['status'],
        adspend: ['adspend'],
        clicks: ['ausg klicks', 'klicks'],
        cpc: ['cpc'],
        cvrStart: ['cvr optin', 'cvr start'],
        leads: ['leads'],
      },
    },
    leads: {
      detect: { all: ['gewonnen am'], any: ['utm_source', 'e-mail'] },
      fields: {
        at: ['gewonnen am'],
        firstName: ['vorname'],
        lastName: ['nachname'],
        name: [],
        email: ['e-mail'],
        utmSource: ['utm_source'],
        utmMedium: ['utm_medium'],
        utmCampaign: ['utm_campaign'],
        utmTerm: ['utm_term'],
        ticketColumn: ['vip-ticket geholt am'],
      },
    },
    // Funnel-Stufe "Termine" (vereinbarte Gespräche). Standardmäßig inaktiv
    // (leeres detect -> matcht nichts); pro Projekt über die Config aktivieren.
    termine: {
      detect: { all: [], any: [] },
      fields: {
        at: ['gewonnen am', 'datum'],
        name: ['name'],
        email: ['e-mail'],
        phone: ['telefon'],
        utmSource: ['utm_source', 'utm source'],
        utmMedium: ['utm_medium', 'utm medium'],
        utmCampaign: ['utm_campaign', 'utm campaign'],
        appointmentAt: ['datum gespräch'],
      },
    },
    // Funnel-Stufe "Closings" (Verkäufe). Pro Verkaufszeile: Umsatz netto/brutto.
    // Cash Collect existiert i. d. R. nur in der Summenzeile (summary*-Felder).
    // Standardmäßig inaktiv.
    closings: {
      detect: { all: [], any: [] },
      fields: {
        at: ['datum kauf'],
        name: ['name'],
        email: ['e-mail'],
        phone: ['telefon'],
        land: ['land'],
        produkt: ['produkt'],
        revenueNet: ['umsatz netto'],
        revenueGross: ['umsatz brutto'],
        ccNet: ['cc netto'],
        ccGross: ['cc brutto'],
        utmSource: ['utm_source', 'utm source'],
        utmMedium: ['utm_medium', 'utm medium'],
        utmCampaign: ['utm_campaign', 'utm campaign'],
        summaryCount: ['closings'],
        summaryCashCollectPaid: ['cash collect paid'],
        summaryCashCollectOrganisch: ['cash collect organisch'],
        summaryUmsatzPaid: ['umsatz paid'],
        summaryUmsatzOrganisch: ['umsatz organisch'],
      },
    },
  },
  questionnaire: {
    detect: {
      any: ['monatliches einkommen', 'immobilien im besitz'],
      all: ['teilgenommen am', 'vorname'],
    },
    fields: {
      at: ['teilgenommen am'],
      firstName: ['vorname'],
      lastName: ['nachname'],
      email: ['e-mail (funnelcockpit)', 'e-mail (typeform)', 'e-mail'],
      emailTypeform: ['e-mail (typeform)'],
      phone: ['handynummer'],
    },
    answers: {
      employment: ['angestellt selbstständig oder unternehmer'],
      challenge: ['größte herausforderung im vermögensaufbau'],
      income: ['monatliches einkommen'],
      realEstate: ['immobilien im besitz'],
      invested: ['geld investiert in den vermögensaufbau wenn ja wie viel'],
      relationship: ['beziehungsstand'],
      expectation: ['was erhoffst du dir von den 4 abenden'],
    },
    leadTicketColumn: ['vip-ticket geholt am'],
  },
};

/** Führt die Projekt-Config mit den Defaults zusammen (bekannte Sektionen tief). */
function mergeConfig(base, over) {
  const q = over.questionnaire;
  const s = over.sheet;
  // Mappt eine Tabellen-Definition (detect/fields) über die Defaults.
  const mergeTable = (b, o) => (o ? { ...b, ...o, detect: { ...b.detect, ...(o.detect || {}) }, fields: { ...b.fields, ...(o.fields || {}) } } : b);
  return {
    ...base,
    ...over,
    branding: { ...base.branding, ...(over.branding || {}) },
    features: { ...base.features, ...(over.features || {}) },
    ticketLabel: { ...base.ticketLabel, ...(over.ticketLabel || {}) },
    sheet: s
      ? {
          ...base.sheet,
          ...s,
          overview: mergeTable(base.sheet.overview, s.overview),
          leads: mergeTable(base.sheet.leads, s.leads),
          termine: mergeTable(base.sheet.termine, s.termine),
          closings: mergeTable(base.sheet.closings, s.closings),
        }
      : base.sheet,
    questionnaire: q
      ? {
          ...base.questionnaire,
          ...q,
          detect: { ...base.questionnaire.detect, ...(q.detect || {}) },
          fields: { ...base.questionnaire.fields, ...(q.fields || {}) },
          answers: { ...base.questionnaire.answers, ...(q.answers || {}) },
        }
      : base.questionnaire,
  };
}

let cached = null;
export function loadProjectConfig() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cached = mergeConfig(DEFAULT_PROJECT, raw);
  } catch {
    cached = DEFAULT_PROJECT;
  }
  return cached;
}

/** Für den Client aufbereiteter, unkritischer Teil (ohne Sheet-Mapping). */
export function publicProject(cfg) {
  return {
    name: cfg.name,
    shortName: cfg.shortName,
    subtitle: cfg.subtitle,
    branding: cfg.branding,
    features: cfg.features,
    ticketLabel: cfg.ticketLabel,
    funnels: cfg.funnels && cfg.funnels.enabled ? cfg.funnels : null,
  };
}
