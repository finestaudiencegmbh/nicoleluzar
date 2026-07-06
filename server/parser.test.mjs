/**
 * Leichtgewichtiger Test ohne Framework: prüft Parser + Dataset-Aufbau gegen
 * Zeilen, die exakt der echten Sheet-Struktur entsprechen (UTM-Werte mit
 * eingebetteten "|", zwei gestapelte Übersichts-Tabellen, doppelter Ticket-Tab).
 * Ausführen:  node server/parser.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';

// Eigenständige GEWICHTETE Scoring-Config (entkoppelt von der Live-scoring.json,
// die inzwischen das criteria-Modell nutzt). Dieser Test deckt den gewichteten
// Ticket-/Fragebogen-Pfad ab.
const WEIGHTED_CFG = {
  weights: { income: 0.8, invested: 0.08, realEstate: 0.07, employment: 0.05 },
  householdRule: { enabled: true, incomeBelow: 3500, relationships: ['verheiratet', 'in einer beziehung', 'beziehung', 'partnerschaft', 'liiert'], cappedScore: 20 },
  income: { tiers: [{ atLeast: 5000, score: 1.0 }, { atLeast: 3500, score: 0.8 }, { atLeast: 2500, score: 0.5 }, { atLeast: 1500, score: 0.25 }, { atLeast: 1000, score: 0.12 }, { atLeast: 0, score: 0.05 }] },
  invested: { none: 0.05, monthly: 0.6, yesGeneric: 0.5, fullScoreAt: 10000 },
  realEstate: { rules: [{ match: 'mehrere', score: 1.0 }, { match: 'zwei', score: 1.0 }, { match: 'ja', score: 0.7 }, { match: 'noch nicht', score: 0.3 }, { match: 'nein', score: 0.0 }] },
  employment: { scores: { unternehmer: 1.0, selbststaendig: 0.9, angestellt: 0.75, rentner: 0.4, arbeitssuchend: 0.2 }, default: 0.5 },
  tiers: [{ key: 'A', label: 'A · Top', min: 75, color: '#16a34a' }, { key: 'B', label: 'B · Gut', min: 55, color: '#65a30d' }, { key: 'C', label: 'C · Mittel', min: 35, color: '#d97706' }, { key: 'D', label: 'D · Schwach', min: 0, color: '#dc2626' }],
};

const overviewSheet = {
  title: 'Anzeigengruppen',
  values: [
    ['Status', 'Anzeigengruppe', 'Adspend', 'Ausg. Klicks', 'CPC', 'CVR Optin', 'CVR Ticket', 'CPL', 'Pro Ticket', 'Quali Rate Ticket', 'Leads', 'VIP Ticket', 'Ticket Nicht Qualifiziert', 'Ticket Qualifiziert'],
    ['AUS', 'J&P | LP 1 | Broad | DACH | W | 30-55', '1.030,66 €', '134', '7,69 €', '9,70%', '46,15%', '79,28 €', '171,78 €', '0,00%', '13', '6', '6', '0'],
    [],
    ['Status', 'Anzeigengruppe', 'Adspend', 'Ausg. Klicks', 'CPC', 'CVR Optin', 'CVR Ticket', 'CPL', 'Pro Ticket', 'Quali Rate Ticket', 'Leads', 'VIP Ticket', 'Ticket Nicht Qualifiziert', 'Ticket Qualifiziert'],
    ['AN', 'AG1: J&P | LP 3 | Broad | DACH | W | 30-55', '1.194,23 €', '120', '9,95 €', '15,00%', '38,89%', '66,35 €', '170,60 €', '42,86%', '18', '7', '4', '3'],
  ],
};

const leadsSheet = {
  title: 'Leads',
  values: [
    ['Gewonnen am', 'Vorname', 'Nachname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'VIP-Ticket geholt am', 'Leads aus Ads', 'Leads Newsletter', 'Leads Insta'],
    ['161', '', '', '', '', '', '', '', '47', '', '', ''], // Zähl-/Summenzeile -> muss ignoriert werden
    ['2026-05-26 20:42:50 +0000', 'Rebecca', 'Schießl', 'schiessl.rebecca@gmail.com', 'J&P | LP 1 | Broad | DACH | W | 30-55', 'LP 1 - Static 16', 'J&P | MMV 15.06.-18.06. | ABO | 260526', 'Facebook_Mobile_Feed', '2026-05-26 20:47:35 +0000', '', '', ''],
    ['2026-05-26 21:00:00 +0000', 'Max', 'Organik', 'max@example.com', 'instagram', 'bio', 'moneymaker-workshop-2026', 'workshop-anmeldung', '', '', '', ''],
    // Lead mit VIP-Ticket, aber OHNE passende Antworten-Zeile:
    // Ticket muss trotzdem dem Creative zugeordnet werden, Qualität bleibt offen.
    ['2026-05-27 09:00:00 +0000', 'Lisa', 'Nolead', 'lisa@example.com', 'J&P | LP 2 | Broad | DACH | W | 30-55', 'LP 2 - Static 19', 'J&P | MMV 15.06.-18.06. | ABO | 260526', 'Instagram_Feed', '2026-05-27 09:05:00 +0000', '', '', ''],
  ],
};

const ticketsSheet = {
  title: 'VIP Ticket',
  values: [
    ['Teilgenommen am', 'Vorname', 'Nachname', 'E-Mail (Funnelcockpit)', 'E-Mail (Typeform)', 'Handynummer', 'Angestellt, Selbstständig oder Unternehmer?', 'Größte Herausforderung im Vermögensaufbau?', 'Monatliches Einkommen', 'Immobilien im Besitz?', 'Geld investiert in den Vermögensaufbau? Wenn ja, wie viel?', 'Beziehungsstand?', 'Was erhoffst du dir von den 4 Abenden?', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term'],
    ['2026-05-26 20:47:35 +0000', 'Rebecca', 'Schießl', 'schiessl.rebecca@gmail.con', 'schiessl.rebecca@gmail.com', '+491783420945', 'Angestellt', 'Strategie finden', '3.500-5.000 im Monat', 'Ja, mehrere', '10000', 'Ledig', 'Klarer Plan', 'J&P | LP 1 | Broad | DACH | W | 30-55', 'LP 1 - Static 16', 'J&P | MMV 15.06.-18.06. | ABO | 260526', 'Facebook_Mobile_Feed'],
  ],
};

// zweiter Ticket-Tab mit derselben Person (muss dedupliziert werden)
const ticketsSheet2 = { title: 'VIP Ticket (raw)', values: ticketsSheet.values.map((r) => [...r]) };

const cfg = WEIGHTED_CFG;
const parsed = parseSheets([overviewSheet, leadsSheet, ticketsSheet, ticketsSheet2]);

assert.equal(parsed.overview.length, 2, 'beide Übersichts-Tabellen erkannt');
assert.equal(parsed.overview[0].adset, 'J&P | LP 1 | Broad | DACH | W | 30-55', 'Pipe-Wert intakt');
assert.equal(parsed.overview[0].adspend, 1030.66, 'deutsches Zahlenformat geparst');
assert.equal(parsed.leads.length, 3, 'Summenzeile ignoriert, 3 echte Leads');
assert.equal(parsed.tickets.length, 1, 'Ticket-Duplikat entfernt');

const ds = buildDataset(parsed, cfg);
const rebecca = ds.leads.find((l) => l.email === 'schiessl.rebecca@gmail.com');
assert.ok(rebecca, 'Lead + Ticket über E-Mail gejoint');
assert.equal(rebecca.hasTicket, true);
assert.equal(rebecca.sourceType, 'paid');
assert.equal(rebecca.campaign, 'J&P | MMV 15.06.-18.06. | ABO | 260526');
assert.equal(rebecca.placement, 'Facebook Mobile Feed');
assert.ok(rebecca.quality && rebecca.quality.score > 0, 'Qualität berechnet');

const max = ds.leads.find((l) => l.email === 'max@example.com');
assert.equal(max.sourceType, 'organic', 'einzelnes Token = organisch');
assert.equal(max.hasTicket, false);

// Lead mit "VIP-Ticket geholt am", aber ohne Antworten-Zeile
const lisa = ds.leads.find((l) => l.email === 'lisa@example.com');
assert.equal(lisa.hasTicket, true, 'Ticket über "VIP-Ticket geholt am" erkannt');
assert.equal(lisa.creative, 'LP 2 - Static 19', 'Creative aus der Lead-Zeile');
assert.equal(lisa.quality, null, 'ohne Antworten keine Qualität');

// Ticket-Zuordnung auf Creative-Ebene (Kernfall des gemeldeten Bugs)
const byCreative = (key) => ds.leads.filter((l) => l.creative === key && l.hasTicket).length;
assert.equal(byCreative('LP 2 - Static 19'), 1, 'Ticket dem Creative zugeordnet');
assert.equal(ds.counts.tickets, 2, 'beide Ticket-Holder gezählt');

// Spend-Zuordnung über Anzeigengruppe
const spendKey = 'j&p | lp 1 | broad | dach | w | 30-55';
assert.equal(ds.overviewByAdset[spendKey].adspend, 1030.66);

console.log('✓ Alle Parser-/Dataset-Tests bestanden');
console.log('  Leads:', ds.counts, '| Quality Rebecca:', rebecca.quality.score, rebecca.quality.tier);
