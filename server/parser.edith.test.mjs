/**
 * Test für das generische Sheet-Mapping am Beispiel des Webinar-Funnel-Sheets
 * "KPIs Webinar B2C_Edith Pauls" (Kopfzeilen 1:1 aus dem echten Sheet).
 * Prüft: Leads-Tab wird über die Projekt-Config erkannt und gemappt, die
 * Creative-Übersicht liefert Adspend je Creative, die Paid/Organic-Klassifizierung
 * greift (CBO-Anzeigengruppe = paid, email/newsletter = organisch) und der
 * Termine-Tab wird NICHT fälschlich als Leads gezählt.
 * Ausführen:  node server/parser.edith.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';

// Eigenständige Projekt-Config (entkoppelt von der LIVE config/project.config.json,
// die ein anderes Projekt beschreibt). Dieser Test sichert das generische Mapping
// gegen ein ZWEITES Sheet-Layout ab (Closings über "Datum Kauf", Overview über
// "CVR Start") – komplementär zu parser.nicole.test.mjs.
const project = {
  name: 'Webinar-Funnel (Mapping-Test)',
  features: { hasTickets: false, hasQuality: false },
  sheet: {
    overview: {
      detect: { all: ['adspend'], any: ['creative', 'anzeigengruppe'] },
      fields: {
        key: ['creative', 'anzeigengruppe'], status: ['status'], adspend: ['adspend'],
        clicks: ['ausg klicks'], cpc: ['cpc'], cvrStart: ['cvr start'], leads: ['leads'],
      },
    },
    leads: {
      detect: { all: ['datum', 'name'], any: ['leads aus ads', 'a/b variante'] },
      fields: {
        at: ['datum'], firstName: ['name'], lastName: [], email: ['e-mail'],
        utmSource: ['utm source'], utmMedium: ['utm medium'], utmCampaign: ['utm campaign'],
        utmTerm: [], ticketColumn: [],
      },
    },
    termine: {
      detect: { all: ['datum gespräch'], any: [] },
      fields: {
        at: ['datum'], name: ['name'], email: ['e-mail'], phone: ['telefon'],
        utmSource: ['utm source'], utmMedium: ['utm medium'], utmCampaign: ['utm campaign'],
        appointmentAt: ['datum gespräch'],
      },
    },
    closings: {
      detect: { all: ['datum kauf', 'produkt'], any: [] },
      fields: {
        at: ['datum kauf'], name: ['name'], email: ['e-mail'], phone: ['telefon'],
        land: ['land'], produkt: ['produkt'], revenueNet: ['umsatz netto'], revenueGross: ['umsatz brutto'],
        utmSource: ['utm source'], utmMedium: ['utm medium'], utmCampaign: ['utm campaign'],
        summaryCount: ['closings'], summaryCashCollectPaid: ['cash collect paid'],
        summaryCashCollectOrganisch: ['cash collect organisch'],
        summaryUmsatzPaid: ['umsatz paid'], summaryUmsatzOrganisch: ['umsatz organisch'],
      },
    },
  },
};
assert.equal(project.features.hasTickets, false, 'dieses Projekt hat keine Tickets');
assert.equal(project.features.hasQuality, false, 'dieses Projekt hat kein Scoring');

// Creative-Übersicht (Adspend je Creative, nicht je Anzeigengruppe)
const overviewSheet = {
  title: 'Übersicht Creatives',
  values: [
    ['Status', 'Creative', 'Adspend', 'CPC', 'Ausg. Klicks', 'CVR Start', 'Leads', 'Termine', 'Closings', 'CPL', 'Pro Termin', 'Pro Close', 'Cash Collect', 'Revenue', 'ROAS', 'ROAS Auftrag'],
    ['AKTIV', 'CBO Creative 7 AG1', '10,43 €', '5,22 €', '2', '200,00%', '4', '3', '3', '2,61 €', '3,48 €', '3,48 €', '0,00 €', '0,00 €', '0,00', '0,00'],
    ['INAKTIV', 'Static 5: Innere Unruhe AG2', '142,71 €', '2,80 €', '51', '9,80%', '5', '2', '1', '28,54 €', '71,36 €', '142,71 €', '0,00 €', '0,00 €', '0,00', '0,00'],
  ],
};

// Leads-Tab (echte Kopfzeile: Datum/Name/E-Mail/UTM …, kein "Gewonnen am")
const leadsSheet = {
  title: 'Leads',
  values: [
    ['Datum', 'Name', 'E-Mail', 'UTM Source', 'UTM Medium', 'UTM  Campaign', 'Leads', 'Leads aus Ads', 'Leads aus Organisch', 'Leads aus Newsletter', 'Leads aus Instagram', 'A/B Variante', 'Variante 1', 'Variante 1', 'Variante 2', 'Variante 2'],
    ['161', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], // Summenzeile -> ignorieren
    ['2026-03-05 19:54:22 +0000', 'Lydia König', 'l.koenig@web.de', 'email', 'mobile', 'workshop', '', '', '', '', '', 'V1', '', '', '', ''],
    ['2026-03-08 14:29:25 +0000', 'Edda Beispiel', 'edda@gmail.com', 'CBO AG2: Mütter 070326', 'Static 2: Beziehungsfähig AG2', 'CBO B2C // Live-Workshop // Leads 060326', '', '', '', '', '', 'V1', '', '', '', ''],
    ['2026-03-09 08:00:00 +0000', 'Nadja Newsletter', 'nadja@gmx.de', 'newsletter-220526', 'link-mobil', 'sacredlifewarteliste', '', '', '', '', '', 'V1', '', '', '', ''],
  ],
};

// Termine-Tab: eigene Funnel-Stufe. Darf NICHT als Leads gezählt werden; nur
// Zeilen mit "Datum Gespräch" zählen (Summen-/Testzeile fallen raus).
const termineSheet = {
  title: 'Termine',
  values: [
    ['Datum', 'Name', 'E-Mail', 'Telefon', 'UTM Source', 'UTM Medium', 'UTM  Campaign', 'Datum Gespräch', 'Termine', 'Termine aus Ads', 'Zielgruppe?', 'Feedback', 'UTM Source', 'UTM Medium', 'UTM  Campaign'],
    ['', '', '', '', 'Lead', '', '', '', '83', '20', '', '', 'Termine', '', ''], // Summenzeile -> ignorieren
    ['2025-09-23 07:32:08 +0000', 'Edith', 'coaching@edithpauls.com', 'phone_number', 'Test', 'Test', 'Test', '', '', '', '', '', '', '', ''], // Testzeile ohne Gespräch -> ignorieren
    ['2026-03-08 14:29:25 +0000', 'Edda Beispiel', 'edda@gmail.com', '+49 176 43188185', 'CBO AG2: Mütter 070326', 'Static 2: Beziehungsfähig AG2', 'CBO B2C // Live-Workshop // Leads 060326', '2026-03-10 11:15:00 +0000', '', '', 'Nein', 'Feedback', 'webinar-geschenk', 'whatsapp', 'first-mover-call'],
    ['2026-03-09 19:11:37 +0000', 'Anke Sendzik', 'anke@googlemail.com', '+49 160 8033022', 'email', 'mobile', 'workshop', '2026-03-11 16:30:00 +0000', '', '', 'Termin abgesagt', 'Feedback', 'live-workshop', 'direktlink', 'calendly'],
  ],
};

// Closings-Tab: Summenzeile (Cash Collect) + zwei Verkaufszeilen
const closingsSheet = {
  title: 'Closings',
  values: [
    ['Datum Kauf', 'Name', 'E-Mail', 'Telefon', 'Land', 'Produkt', 'Umsatz netto', 'Umsatz brutto', 'UTM Source', 'UTM Medium', 'UTM  Campaign', 'Closings', 'Closings Paid', 'Umsatz Paid', 'Cash Collect Paid', 'Umsatz Organisch', 'Cash Collect Organisch'],
    ['', '', '', '', '', '', '5.665,00 €', '5.998,00 €', '', '', '', '2', '1', '1.998,00 €', '1.665,00 €', '4.000,00 €', '3.500,00 €'], // Summenzeile
    ['2026-03-04T08:01Z', 'Ivana Ebert', 'ivana@ebert.com', '', 'Österreich', 'Gefühlsklar', '1.665,00 €', '1.998,00 €', 'CBO AG7: Selbstständige', 'AG7 Creative 9', 'CBO B2C // Live-Webinar', '', '', '', '', '', ''],
    ['2026-03-11T21:45Z', 'Elisabeth U.', 'eli@outlook.de', '', 'Deutschland', 'Gefühlsklar', '3.333,00 €', '4.000,00 €', '', '', '', '', '', '', '', '', ''],
  ],
};

const parsed = parseSheets([overviewSheet, leadsSheet, termineSheet, closingsSheet], project);

assert.equal(parsed.overview.length, 2, 'beide Creative-Zeilen erkannt');
assert.equal(parsed.overview[0].adset, 'CBO Creative 7 AG1', 'Creative-Name als Schlüssel');
assert.equal(parsed.overview[0].adspend, 10.43, 'deutsches Zahlenformat geparst');
assert.equal(parsed.leads.length, 3, 'Summenzeile ignoriert, Termine-Tab NICHT als Leads gezählt');
assert.equal(parsed.termine.length, 2, 'nur Zeilen mit Datum Gespräch (Summen-/Testzeile raus)');

const ds = buildDataset(parsed, loadScoringConfig(), project);
const edda = ds.leads.find((l) => l.email === 'edda@gmail.com');
const lydia = ds.leads.find((l) => l.email === 'l.koenig@web.de');
const nadja = ds.leads.find((l) => l.email === 'nadja@gmx.de');

assert.ok(edda && lydia && nadja, 'alle drei Leads im Dataset');
assert.equal(edda.name, 'Edda Beispiel', 'Einzel-Spalte "Name" korrekt übernommen');
assert.equal(edda.sourceType, 'paid', 'CBO-Anzeigengruppe = bezahlt (paidPatterns)');
assert.equal(edda.campaign, 'CBO B2C // Live-Workshop // Leads 060326', 'UTM Campaign gemappt');
assert.equal(edda.adset, 'CBO AG2: Mütter 070326', 'UTM Source -> Anzeigengruppe');
assert.equal(edda.creative, 'Static 2: Beziehungsfähig AG2', 'UTM Medium -> Creative');
assert.equal(lydia.sourceType, 'organic', 'email-Quelle = organisch');
assert.equal(nadja.sourceType, 'organic', 'newsletter = organisch');
assert.equal(edda.hasTicket, false, 'keine Ticket-Logik in diesem Projekt');
assert.equal(edda.quality, null, 'kein Scoring in diesem Projekt');

// Termine-Funnelstufe im Dataset
assert.equal(ds.counts.termine, 2, 'zwei Termine im Dataset');
assert.equal(ds.counts.paidTermine, 1, 'ein Termin über Ads (CBO), einer organisch (email)');
const terminEdda = ds.termine.find((t) => t.email === 'edda@gmail.com');
assert.equal(terminEdda.sourceType, 'paid', 'CBO-Termin = bezahlt');
assert.equal(terminEdda.adset, 'CBO AG2: Mütter 070326', 'Termin-Attribution über UTM');
assert.ok(terminEdda.appointmentAt, 'Gesprächs-Datum übernommen');

// Closings-Funnelstufe
assert.equal(ds.counts.closings, 2, 'zwei Verkäufe (Summenzeile ignoriert)');
assert.equal(ds.counts.paidClosings, 1, 'ein Verkauf über Ads (CBO), einer organisch');
const ivana = ds.closings.find((c) => c.email === 'ivana@ebert.com');
assert.equal(ivana.sourceType, 'paid', 'CBO-Verkauf = bezahlt');
assert.equal(ivana.revenueGross, 1998, 'Umsatz brutto geparst');
assert.equal(ds.closingsSummary.cashCollect, 5165, 'Cash Collect aus Summenzeile (1.665 + 3.500)');

console.log('✓ Alle Edith-Webinar-Mapping-Tests bestanden');
console.log('  Leads:', ds.counts, '| paid:', ds.leads.filter((l) => l.sourceType === 'paid').length, '| organic:', ds.leads.filter((l) => l.sourceType === 'organic').length);
