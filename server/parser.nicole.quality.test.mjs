/**
 * Lead-Scoring Nicole Luzar (criteria-Modell). Prüft das deterministische
 * KO-/Kriterien-Zählmodell end-to-end über den echten "Umfrage NEU"-Aufbau:
 * KO hat Vorrang, A=5/B=4/C≤3, Freitext-Invest zählt nicht als erfüllt,
 * exakte Dropdown-Werte (z. B. "Über 5.000 €") und der Stichtag (validFrom).
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
assert.equal(scoring.validFrom, '2026-07-03', 'Stichtag 03.07.2026');

// Echte Kopfzeile aus dem CSV-Export von "Umfrage NEU".
const H = ['Datum', 'Name', 'Telefonnummer', 'E-Mail', 'Alter', 'Berufsstand', 'Beziehungsstand', 'Anzahl Pferde', 'Pferde mit Problemen', 'Probleme und Lösungen', 'Geld in Lösung investiert?', 'UTM Source', 'UTM Medium', 'UTM  Campaign'];
// Zeile bauen: nur die scoring-relevanten Felder + Datum/Medium interessieren.
const row = ({ datum, alter, beruf, pferde, problem, invest, medium }) =>
  [datum, 'Name', '', 'x@example.com', alter, beruf, 'Ledig', pferde, problem, 'txt', invest, 'src', medium, 'camp'];

const umfrage = {
  title: 'Umfrage NEU',
  values: [
    H,
    // A: alle 5 Kriterien erfüllt
    row({ datum: '2026-07-03 10:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', pferde: '2-3', problem: 'Mehrere Pferde', invest: 'Über 5.000 €', medium: 'ad-A' }),
    // B: 4/5 (Invest "1.000 - 2.500 €" ist KEIN A-Kriterium)
    row({ datum: '2026-07-05 10:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', pferde: '2-3', problem: 'Ein Pferd', invest: '1.000 - 2.500 €', medium: 'ad-B' }),
    // C: 2/5 (Bis 24 Jahre + Anzahl 1 + Invest "Unter 1.000 €" zählen nicht)
    row({ datum: '2026-07-05 11:00:00', alter: 'Bis 24 Jahre', beruf: 'Angestellte', pferde: '1', problem: 'Ein Pferd', invest: 'Unter 1.000 €', medium: 'ad-C' }),
    // D via KO Berufsstand "Arbeitssuchend" – trotz sonst starker Angaben (Vorrang!)
    row({ datum: '2026-07-03 12:00:00', alter: '40 - 59 Jahre', beruf: 'Arbeitssuchend', pferde: '4-6', problem: 'Mehrere Pferde', invest: '2.500 - 5.000 €', medium: 'ad-D1' }),
    // D via KO "Pferde mit Problemen = Keins"
    row({ datum: '2026-07-04 09:00:00', alter: '25 - 39 Jahre', beruf: 'Selbstständig / Unternehmerin', pferde: '2-3', problem: 'Keins', invest: 'Über 5.000 €', medium: 'ad-D2' }),
    // D via KO Invest exakt "Nein"
    row({ datum: '2026-07-06 09:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', pferde: '2-3', problem: 'Ein Pferd', invest: 'Nein', medium: 'ad-D3' }),
    // Freitext-Invest (Altbestand): Kriterium 5 NICHT erfüllt, KEIN KO -> hier 4/5 = B
    row({ datum: '2026-07-04 15:00:00', alter: '40 - 59 Jahre', beruf: 'Angestellte', pferde: '2-3', problem: 'Ein Pferd', invest: 'Tausende', medium: 'ad-free' }),
    // VOR dem Stichtag -> darf NICHT bewertet werden
    row({ datum: '2026-07-02 23:59:59', alter: '40 - 59 Jahre', beruf: 'Angestellte', pferde: '2-3', problem: 'Mehrere Pferde', invest: 'Über 5.000 €', medium: 'ad-old' }),
  ],
};

const parsed = parseSheets([umfrage], project);
assert.equal(parsed.tickets.length, 8, 'alle 8 Umfrage-Zeilen erkannt (Stichtag greift erst in build)');

const ds = buildDataset(parsed, scoring, project);
assert.ok(ds.quality, 'quality-Zusammenfassung vorhanden');
const rows = ds.quality.rows;
const tierOf = (m) => rows.find((r) => r.medium === m)?.tier;

assert.equal(rows.length, 7, 'Zeile vor dem Stichtag ist ausgeschlossen (7 statt 8)');
assert.equal(rows.find((r) => r.medium === 'ad-old'), undefined, 'Pre-Stichtag-Zeile nicht bewertet');
assert.equal(tierOf('ad-A'), 'A', '5/5 -> A');
assert.equal(tierOf('ad-B'), 'B', '4/5 -> B');
assert.equal(tierOf('ad-C'), 'C', '2/5 -> C');
assert.equal(tierOf('ad-D1'), 'D', 'KO Arbeitssuchend -> D (Vorrang vor A-Kriterien)');
assert.equal(tierOf('ad-D2'), 'D', 'KO Pferde=Keins -> D');
assert.equal(tierOf('ad-D3'), 'D', 'KO Invest exakt "Nein" -> D');
assert.equal(tierOf('ad-free'), 'B', 'Freitext-Invest zählt nicht (4/5) und löst kein KO aus');

// Direkter Determinismus-Check: gleiche Eingabe -> gleiches Tier
const a = { alter: '40 - 59 Jahre', berufsstand: 'Angestellte', anzahlPferde: '7+', pferdeProbleme: 'Mehrere Pferde', invest: '2.500 - 5.000 €' };
assert.equal(computeQuality(a, scoring).tier, 'A');
assert.equal(computeQuality(a, scoring).tier, computeQuality({ ...a }, scoring).tier, 'deterministisch');
// Leere Felder: kein KO, kein A-Kriterium -> C
assert.equal(computeQuality({ alter: '', berufsstand: '', anzahlPferde: '', pferdeProbleme: '', invest: '' }, scoring).tier, 'C', 'leer = C (kein KO)');

console.log('✓ Alle Nicole-Qualitäts-Tests (criteria) bestanden');
console.log('  Tiers:', rows.map((r) => `${r.medium}:${r.tier}`).join(' '));
