/**
 * Lead-Scoring Nicole Luzar (PUNKTE-Modell, Umfrage 3007). Prüft KO-Vorrang,
 * die Punktevergabe je Dimension (Commitment/Intent/Need/Dringlichkeit/
 * Kaufkraft), die Tier-Schwellen (A≥9, B 6–8, C≤5), den Stichtag sowie das
 * robuste Feld-Matching langer Fragetexte (Teilstring) inkl. Gedankenstrich "–".
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
assert.equal(scoring.model, 'points', 'Punkte-Modell aktiv');
assert.equal(scoring.validFrom, '2026-07-30', 'Stichtag 30.07.2026');

const H = [
  'Datum', 'Name', 'Telefonnummer', 'E-Mail', 'Alter', 'Berufsstand',
  'Hat dein Pferd aktuell ein gesundheitliches oder wiederkehrendes Problem, das trotz Tierarzt, Trainer, Osteopath oder anderer Maßnahmen bisher nicht dauerhaft besser geworden ist?',
  'Wie lange suchst du bereits nach einer dauerhaften Lösung?',
  'Was würdest du am liebsten sofort verändern?',
  'Was trifft am ehesten auf dich zu?',
  'Bist du bereit, neue Wege zu gehen - auch wenn sie sich von dem unterscheiden, was du bisher kennst?',
  'UTM Source', 'UTM Medium', 'UTM  Campaign',
];
const TRIFFT = 'Ich suche vor allem eine Behandlung, die endlich wirkt.';
const row = ({ datum, alter, beruf, gesund, laenge, trifft, bereit, medium }) =>
  [datum, 'Name', '', 'x@example.com', alter, beruf, gesund, laenge, '❤️ egal', trifft, bereit, 'src', medium, 'camp'];

const umfrage = {
  title: 'Umfrage 3007',
  values: [
    H,
    // A = 11: Selbst(2)+Need Ja(2)+Dringl >3J(2)+Intent(2)+Commit(3)
    row({ datum: '2026-07-30 10:00:00', alter: '40 - 59 Jahre', beruf: 'Selbstständig / Unternehmerin', gesund: 'Ja', laenge: 'Mehr als 3 Jahre', trifft: TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-A' }),
    // B = 6: Angestellte(1)+Ja(2)+3–12 Monate(1)+Intent(2)+"Kommt drauf an"(0)
    row({ datum: '2026-08-05 10:00:00', alter: '25 - 39 Jahre', beruf: 'Angestellte', gesund: 'Ja', laenge: '3–12 Monate', trifft: TRIFFT, bereit: 'Kommt drauf an, ob es mich überzeugt.', medium: 'ad-B' }),
    // C = 2: Angestellte(1)+Teilweise(1)+Unter 3 Monaten(0)+"weiß nicht"(0)+"Kommt drauf an"(0)
    row({ datum: '2026-09-01 10:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', gesund: 'Teilweise', laenge: 'Unter 3 Monaten', trifft: 'Ich weiß noch gar nicht genau, was ich suche.', bereit: 'Kommt drauf an, ob es mich überzeugt.', medium: 'ad-C' }),
    // D via KO Berufsstand
    row({ datum: '2026-07-30 12:00:00', alter: '40 - 59 Jahre', beruf: 'Rentnerin', gesund: 'Ja', laenge: '1–3 Jahre', trifft: TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-D1' }),
    // D via KO Alter 60+
    row({ datum: '2026-08-02 09:00:00', alter: '60 Jahre oder älter', beruf: 'Angestellte', gesund: 'Ja', laenge: '1–3 Jahre', trifft: TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-D2' }),
    // D via KO Gesundheit "Nein"
    row({ datum: '2026-09-02 10:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', gesund: 'Nein', laenge: '1–3 Jahre', trifft: TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-D3' }),
    // vor Stichtag -> nicht bewerten
    row({ datum: '2026-07-29 23:59:59', alter: '40 - 59 Jahre', beruf: 'Selbstständig / Unternehmerin', gesund: 'Ja', laenge: 'Mehr als 3 Jahre', trifft: TRIFFT, bereit: 'Ja, ich bin bereit.', medium: 'ad-old' }),
  ],
};

const parsed = parseSheets([umfrage], project);
assert.equal(parsed.tickets.length, 7, 'alle 7 Umfrage-Zeilen erkannt (Teilstring-Detect)');
assert.equal(parsed.tickets[0].answers.bereit, 'Ja, ich bin bereit.', 'langes Feld "Bist du bereit" per Teilstring gemappt');

const ds = buildDataset(parsed, scoring, project);
const rows = ds.quality.rows;
const tierOf = (m) => rows.find((r) => r.medium === m)?.tier;

assert.equal(rows.length, 6, 'Zeile vor dem Stichtag ausgeschlossen (6 statt 7)');
assert.equal(tierOf('ad-A'), 'A', '11 Punkte -> A');
assert.equal(tierOf('ad-B'), 'B', '6 Punkte -> B');
assert.equal(tierOf('ad-C'), 'C', '2 Punkte -> C');
assert.equal(tierOf('ad-D1'), 'D', 'KO Rentnerin -> D (Vorrang)');
assert.equal(tierOf('ad-D2'), 'D', 'KO Alter 60+ -> D');
assert.equal(tierOf('ad-D3'), 'D', 'KO Gesundheit "Nein" -> D');

// Direkte Punkte-Checks
const p = (o) => computeQuality(o, scoring);
assert.equal(p({ berufsstand: 'Selbstständig / Unternehmerin', gesundheit: 'Ja', laengeSuche: 'Mehr als 3 Jahre', wasTrifftZu: TRIFFT, bereit: 'Ja, ich bin bereit.', alter: '40 - 59 Jahre' }).points, 11, 'Maximalpunktzahl 11');
assert.equal(p({ berufsstand: 'Angestellte', gesundheit: 'Teilweise', laengeSuche: '3–12 Monate', wasTrifftZu: 'x', bereit: 'Kommt drauf an, ob es mich überzeugt.', alter: '40 - 59 Jahre' }).points, 3, 'Angestellte1+Teilweise1+3–12Mon1 = 3');
assert.equal(p({ alter: '', berufsstand: '', gesundheit: '', laengeSuche: '', wasTrifftZu: '', bereit: '' }).tier, 'C', 'leer = 0 Punkte, kein KO -> C');
assert.equal(p({ berufsstand: 'Arbeitssuchend', gesundheit: 'Ja', bereit: 'Ja, ich bin bereit.', wasTrifftZu: TRIFFT, laengeSuche: 'Mehr als 3 Jahre', alter: '40 - 59 Jahre' }).tier, 'D', 'KO Arbeitssuchend hat Vorrang vor Punkten');

console.log('✓ Alle Nicole-Qualitäts-Tests (Punkte-Modell) bestanden');
console.log('  Tiers:', rows.map((r) => `${r.medium}:${r.tier}`).join(' '));
