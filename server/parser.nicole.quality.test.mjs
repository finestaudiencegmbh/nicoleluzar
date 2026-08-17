/**
 * Lead-Scoring Nicole Luzar (criteria-Modell, Umfrage 3007). Prüft das
 * deterministische KO-/Kriterien-Zählmodell end-to-end über den echten
 * "Umfrage 3007"-Aufbau (lange Fragetexte -> Teilstring-Matching, exakte
 * Dropdown-Werte inkl. Gedankenstrich "–", KO-Vorrang, A=6/B=5/C≤4, Stichtag).
 * Ausführen:  node server/parser.nicole.quality.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';
import { loadProjectConfig } from './project.js';
import { computeQuality } from './scoring.js';

const project = loadProjectConfig();
const scoring = loadScoringConfig();
assert.equal(project.features.hasQuality, true, 'hasQuality aktiv');
assert.equal(scoring.model, 'criteria', 'criteria-Modell aktiv');
assert.equal(scoring.validFrom, '2026-07-30', 'Stichtag 30.07.2026');

// Echte Kopfzeile aus dem CSV-Export von "Umfrage 3007" (lange Fragetexte).
const H = [
  'Datum', 'Name', 'Telefonnummer', 'E-Mail', 'Alter', 'Berufsstand',
  'Hat dein Pferd aktuell ein gesundheitliches oder wiederkehrendes Problem, das trotz Tierarzt, Trainer, Osteopath oder anderer Maßnahmen bisher nicht dauerhaft besser geworden ist?',
  'Wie lange suchst du bereits nach einer dauerhaften Lösung?',
  'Was würdest du am liebsten sofort verändern?',
  'Was trifft am ehesten auf dich zu?',
  'Bist du bereit, neue Wege zu gehen - auch wenn sie sich von dem unterscheiden, was du bisher kennst?',
  'UTM Source', 'UTM Medium', 'UTM  Campaign',
];
const A_TRIFFT = 'Ich suche vor allem eine Behandlung, die endlich wirkt.';
const row = ({ datum, alter, beruf, gesund, laenge, trifft, bereit, medium }) =>
  [datum, 'Name', '', 'x@example.com', alter, beruf, gesund, laenge, '❤️ egal', trifft, bereit, 'src', medium, 'camp'];

const umfrage = {
  title: 'Umfrage 3007',
  values: [
    H,
    // A: alle 6 Kriterien erfüllt
    row({ datum: '2026-07-30 10:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', gesund: 'Ja', laenge: '1–3 Jahre', trifft: A_TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-A' }),
    // B: 5/6 (Bereitschaft = "Kommt drauf an" -> Kriterium 6 nicht erfüllt)
    row({ datum: '2026-07-31 10:00:00', alter: '25 - 39 Jahre', beruf: 'Selbstständig / Unternehmerin', gesund: 'Ja', laenge: 'Mehr als 3 Jahre', trifft: A_TRIFFT, bereit: 'Kommt drauf an, ob es mich überzeugt.', medium: 'ad-B' }),
    // C: 2/6 (Gesundheit "Teilweise" zählt nicht, Länge "Unter 3 Monaten", trifft/bereit neutral)
    row({ datum: '2026-08-01 10:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', gesund: 'Teilweise', laenge: 'Unter 3 Monaten', trifft: 'Ich weiß noch gar nicht genau, was ich suche.', bereit: 'Nicht so wichtig.', medium: 'ad-C' }),
    // D via KO Berufsstand "Rentnerin" (trotz sonst perfekter Angaben)
    row({ datum: '2026-07-30 12:00:00', alter: '40 - 59 Jahre', beruf: 'Rentnerin', gesund: 'Ja', laenge: '1–3 Jahre', trifft: A_TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-D1' }),
    // D via KO Alter "60 Jahre oder älter"
    row({ datum: '2026-08-02 09:00:00', alter: '60 Jahre oder älter', beruf: 'Angestellte', gesund: 'Ja', laenge: '1–3 Jahre', trifft: A_TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-D2' }),
    // D via KO Gesundheit "Nein"
    row({ datum: '2026-08-02 10:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', gesund: 'Nein', laenge: '1–3 Jahre', trifft: A_TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-D3' }),
    // VOR Stichtag -> nicht bewerten
    row({ datum: '2026-07-29 23:59:59', alter: '40 - 59 Jahre', beruf: 'Angestellte', gesund: 'Ja', laenge: '1–3 Jahre', trifft: A_TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-old' }),
  ],
};

const parsed = parseSheets([umfrage], project);
assert.equal(parsed.tickets.length, 7, 'alle 7 Umfrage-Zeilen erkannt (Teilstring-Detect)');
// Robustes Feld-Matching: langer Fragetext korrekt zugeordnet
assert.equal(parsed.tickets[0].answers.gesundheit, 'Ja', 'Gesundheits-Frage per Teilstring gemappt');
assert.equal(parsed.tickets[0].answers.bereit, 'Ja, ich bin bereit.', 'Bereitschafts-Frage per Teilstring gemappt');

const ds = buildDataset(parsed, scoring, project);
const rows = ds.quality.rows;
const tierOf = (m) => rows.find((r) => r.medium === m)?.tier;

assert.equal(rows.length, 6, 'Zeile vor dem Stichtag ausgeschlossen (6 statt 7)');
assert.equal(rows.find((r) => r.medium === 'ad-old'), undefined, 'Pre-Stichtag nicht bewertet');
assert.equal(tierOf('ad-A'), 'A', '6/6 -> A');
assert.equal(tierOf('ad-B'), 'B', '5/6 -> B');
assert.equal(tierOf('ad-C'), 'C', '2/6 -> C');
assert.equal(tierOf('ad-D1'), 'D', 'KO Rentnerin -> D (Vorrang)');
assert.equal(tierOf('ad-D2'), 'D', 'KO Alter 60+ -> D');
assert.equal(tierOf('ad-D3'), 'D', 'KO Gesundheit "Nein" -> D');

// Direkte Determinismus-/Edge-Checks
const a = { alter: '40 - 59 Jahre', berufsstand: 'Angestellte', gesundheit: 'Ja', laengeSuche: '3–12 Monate', wasTrifftZu: 'Ich möchte endlich verstehen, warum mein Pferd dieses Problem hat.', bereit: 'Ja, ich bin bereit.' };
assert.equal(computeQuality(a, scoring).tier, 'A', '6/6 direkt');
assert.equal(computeQuality({ ...a, gesundheit: 'Teilweise' }, scoring).tier, 'B', '"Teilweise" zählt nicht (5/6) und ist kein KO');
assert.equal(computeQuality({ ...a, bereit: 'Das ist mir extrem wichtig.' }, scoring).tier, 'A', 'Wichtigkeits-Top-Box zählt auch als Bereitschaft (6/6)');
assert.equal(computeQuality({ alter: '', berufsstand: '', gesundheit: '', laengeSuche: '', wasTrifftZu: '', bereit: '' }, scoring).tier, 'C', 'leer = C (kein KO)');

console.log('✓ Alle Nicole-Qualitäts-Tests (Umfrage 3007) bestanden');
console.log('  Tiers:', rows.map((r) => `${r.medium}:${r.tier}`).join(' '));
