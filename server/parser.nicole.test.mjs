/**
 * Test für das generische Sheet-Mapping am Beispiel des Nicole-Luzar-Sheets
 * (Kopfzeilen 1:1 aus dem echten Sheet). Sichert die projektspezifischen
 * Besonderheiten ab, die sich vom vorigen Projekt unterscheiden:
 *   - Creative-Übersicht nutzt "CVR Webinar" (statt "CVR Start")
 *   - Closings-Tab hat die Kaufspalte "Datum" (statt "Datum Kauf")
 *   - der "Umfrage"-Tab (Datum/Vorname/Nachname/…) darf NICHT als Leads zählen
 *     (Scoring/Tickets sind in diesem Projekt aus)
 * Ausführen:  node server/parser.nicole.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets, _internal } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';
import { loadProjectConfig } from './project.js';

const project = loadProjectConfig();
assert.equal(project.name, 'Nicole Luzar', 'Projekt-Config geladen');
assert.equal(project.features.hasTickets, false, 'dieses Projekt hat keine Tickets');
assert.equal(project.features.hasQuality, true, 'dieses Projekt nutzt Lead-Qualität (Umfrage NEU)');

// Creative-Übersicht (Adspend je Creative) – echte Kopfzeile mit "CVR Webinar".
const overviewSheet = {
  title: 'Übersicht',
  values: [
    ['Creative', 'Adspend', 'Leads', 'Teilnehmer', 'Calls', 'Closings', 'CPL', 'Pro Teilnehmer', 'SUR', 'Pro Call', 'Pro Close', 'CVR Webinar', 'CPC', 'Ausg. Klicks', 'Umsatz', 'netto CC', 'ROAS', 'ROAS CC', 'Status'],
    ['20260603 C18 ABO AG6', '142,71 €', '7', '0', '0', '0', '20,39 €', '0,00 €', '0,00%', '0,00 €', '0,00 €', '9,80%', '2,80 €', '51', '0,00 €', '0,00 €', '0,00', '0,00', 'AKTIV'],
    ['20260603 C19 ABO AG6', '', '0', '0', '0', '0', '0,00 €', '0,00 €', '0,00%', '0,00 €', '0,00 €', '0,00%', '0,00 €', '', '0,00 €', '0,00 €', '0,00', '0,00', 'AN'],
  ],
};

// Leads-Tab (Live-Webinar) – echte Kopfzeile: Datum/Name/E-Mail/UTM …
const leadsSheet = {
  title: 'Leads',
  values: [
    ['Datum', 'Name', 'E-Mail', 'Telefonnummer', 'UTM Source', 'UTM Medium', 'UTM  Campaign', 'Leads', 'Leads aus Ads', 'Leads aus Organisch', 'Leads aus Newsletter', 'Leads aus Instagram', 'A/B Variante', 'Variante 1', 'Variante 1', 'Variante 2', 'Variante 2'],
    ['', '', '', '', '0', '', '', '187', '755', '-568', '0', '0', '', '0', '', '0', ''], // Summenzeile -> ignorieren
    ['2026-03-14 00:38:01 +0000', 'Jessica Semelka', 'jessica.semelka@gmail.com', '', 'Kampagne 1  - DACH - Broad Reiten', 'Ich suche Pferdemenschen 2.0', 'HW-Show - ABO', '', '', '', '', '', '', '', '', '', ''],
    ['2026-03-15 09:10:00 +0000', 'Nadja Newsletter', 'nadja@gmx.de', '', 'newsletter-maerz', 'link', 'sacredlife', '', '', '', '', '', '', '', '', '', ''],
  ],
};

// Termine-Tab: eigene Funnel-Stufe. Nur Zeilen mit "Datum Gespräch" zählen.
const termineSheet = {
  title: 'Termine',
  values: [
    ['Datum', 'Name', 'E-Mail', 'Telefon', 'UTM Source', 'UTM Medium', 'UTM  Campaign', 'Datum Gespräch', 'Termine', 'Termine aus Ads', 'Zielgruppe?', 'Feedback', 'UTM Source', 'UTM Medium', 'UTM  Campaign'],
    ['', '', '', '', 'Lead', '', '', '', '0', '0', '', '', 'Termine', '', ''], // Summenzeile -> ignorieren
    ['2026-04-16 19:02:18', 'Jessica Semelka', 'jessica.semelka@gmail.com', '', 'Kampagne 1  - DACH - Broad Reiten', 'Ich suche Pferdemenschen 2.0', 'HW-Show - ABO', '2026-04-18 12:30:00 +0000', '', '', '', '', '', '', ''],
    ['2026-04-16 19:43:48', 'Petra Seher', 'petra.seher@gmx.at', '', 'show-calendly', 'live', 'show-calendly', '2026-04-17 20:00:00 +0000', '', '', '', '', '', '', ''],
  ],
};

// Closings-Tab: Kaufdatum in Spalte "Datum" (NICHT "Datum Kauf") + Summenzeile.
const closingsSheet = {
  title: 'Closings',
  values: [
    ['Datum', 'Name', 'E-Mail', 'Telefon', 'Land', 'Produkt', 'CC netto', 'CC brutto', 'Umsatz netto', 'Umsatz brutto', 'UTM Source', 'UTM Medium', 'UTM  Campaign', 'Closings', 'Closings Paid', 'Umsatz Paid', 'Cash Collect Paid', 'Umsatz Organisch', 'Cash Collect Organisch'],
    ['', '', '', '', '', '', '44.151,83 €', '51.439,28 €', '72.706,80 €', '85.414,00 €', '', '', '', '42', '10', '20.191,68 €', '12.171,07 €', '52.515,12 €', '31.980,76 €'], // Summenzeile
    ['2026-03-31', 'Diana v.Dall Armi', 'diana@gmx.de', '', 'Deutschland', 'Leben in Leichtigkeit', '4.957,98 €', '5.900,00 €', '4.957,98 €', '5.900,00 €', 'Kampagne 1  - DACH - Broad Reiten', 'Ich suche Pferdemenschen 2.0', 'HW-Show - ABO', '', '', '', '', '', ''],
    ['2026-04-01', 'Alexandra Vedana', 'alexa@proton.me', '', 'Schweiz', 'Leben in Leichtigkeit', '5.457,91 €', '5.900,00 €', '5.457,91 €', '5.900,00 €', '', '', '', '', '', '', '', '', ''],
  ],
};

// "Umfrage"-Tab: derzeit OHNE Fragebogen-Daten. Darf NICHT als Leads/Tickets
// erkannt werden (kein "name", kein "teilgenommen am").
const umfrageSheet = {
  title: 'Umfrage',
  values: [
    ['Datum', 'Vorname', 'Nachname', 'Telefonnummer', 'E-Mail'],
    ['2026-04-02 10:00:00 +0000', 'Test', 'Person', '0170', 'test@example.com'],
  ],
};

// Datumsformate: ISO (+0000) UND deutsches Optin-Format müssen beide greifen –
// und Zähl-/Summenzeilen ("161") dürfen NICHT als Datum gelten.
const pd = _internal.parseDate;
assert.equal(pd('2026-07-13 00:04:39 +0000'), '2026-07-13T00:04:39.000Z', 'ISO +0000');
assert.equal(pd('13.7.2026 01:08:37'), '2026-07-13T01:08:37.000Z', 'deutsches Format mit Uhrzeit');
assert.equal(pd('13.07.2026'), '2026-07-13T00:00:00.000Z', 'deutsches Format nur Datum');
assert.equal(pd('161'), null, 'Summenzeile ist kein Datum');
assert.equal(pd('47'), null, 'Zählzeile ist kein Datum');

const parsed = parseSheets([overviewSheet, leadsSheet, termineSheet, closingsSheet, umfrageSheet], project);

assert.equal(parsed.overview.length, 2, 'beide Creative-Zeilen erkannt');
assert.equal(parsed.overview[0].adset, '20260603 C18 ABO AG6', 'Creative-Name als Schlüssel');
assert.equal(parsed.overview[0].adspend, 142.71, 'deutsches Zahlenformat geparst');
assert.equal(parsed.overview[0].cvrStart, 9.8, 'CVR Webinar -> cvrStart gemappt');
assert.equal(parsed.leads.length, 2, 'Summenzeile + Umfrage-Tab NICHT als Leads gezählt');
assert.equal(parsed.tickets.length, 0, 'Umfrage-Tab NICHT als Fragebogen/Tickets erkannt');
assert.equal(parsed.termine.length, 2, 'nur Zeilen mit Datum Gespräch');
assert.equal(parsed.closings.length, 2, 'zwei Verkäufe über Spalte "Datum" erkannt');

const ds = buildDataset(parsed, loadScoringConfig(), project);
const jessica = ds.leads.find((l) => l.email === 'jessica.semelka@gmail.com');
const nadja = ds.leads.find((l) => l.email === 'nadja@gmx.de');
assert.ok(jessica && nadja, 'beide Leads im Dataset');
assert.equal(jessica.name, 'Jessica Semelka', 'Einzel-Spalte "Name" korrekt übernommen');
assert.equal(jessica.sourceType, 'paid', 'Ads-Lead (Kampagne/Broad Reiten/HW-Show, OHNE Pipe) = bezahlt');
assert.equal(nadja.sourceType, 'organic', 'newsletter/sacredlife = organisch');
assert.equal(jessica.hasTicket, false, 'keine Ticket-Logik in diesem Projekt');
assert.equal(jessica.quality, null, 'Leads tragen im criteria-Modus keinen Per-Lead-Score (Umfrage ist eigene Einheit)');

// Funnel: Termine + Closings
assert.equal(ds.counts.termine, 2, 'zwei Termine');
assert.equal(ds.counts.closings, 2, 'zwei Verkäufe (Summenzeile ignoriert)');
assert.equal(ds.counts.paidClosings, 1, 'ein Verkauf über Ads, einer organisch');
const diana = ds.closings.find((c) => c.email === 'diana@gmx.de');
assert.equal(diana.sourceType, 'paid', 'Ads-Verkauf = bezahlt');
assert.equal(diana.revenueGross, 5900, 'Umsatz brutto geparst');
assert.equal(diana.cashCollectNet, 4957.98, 'CC netto (Spalte G) geparst');
assert.equal(diana.cashCollectGross, 5900, 'CC brutto (Spalte H) geparst');
assert.equal(ds.closingsSummary.umsatzPaid, 20191.68, 'Umsatz Paid aus Summenzeile');

console.log('✓ Alle Nicole-Luzar-Mapping-Tests bestanden');
console.log('  Leads:', ds.counts, '| paid:', ds.leads.filter((l) => l.sourceType === 'paid').length, '| organic:', ds.leads.filter((l) => l.sourceType === 'organic').length);
