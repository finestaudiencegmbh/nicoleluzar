/**
 * Funnel-Segmentierung (Live/VSL). Prüft die Klassifizierung (Tab-Titel zuerst,
 * dann UTM/Kampagnenname) und die End-to-End-Zuordnung: zwei Leads-Tabs
 * ('Leads' = Webinar, 'VSL Leads' = VSL) + funnel-Tag je Datensatz.
 * Ausführen:  node server/funnels.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';
import { loadProjectConfig } from './project.js';
import { funnelForRecord, funnelForName, activeFunnels } from './funnels.js';

const project = loadProjectConfig();
const funnels = activeFunnels(project);
assert.ok(funnels, 'Funnels aktiv');

// 1) Direkte Klassifizierung
assert.equal(funnelForRecord(funnels, 'VSL Leads', { source: '', medium: '', campaign: '' }), 'vsl', 'Tab "VSL Leads" -> vsl (Titel hat Vorrang)');
assert.equal(funnelForRecord(funnels, 'Leads', { source: 'HW Show', medium: 'x', campaign: 'HW-Show - ABO' }), 'live', 'Webinar-Tab/UTM -> live (Default)');
assert.equal(funnelForRecord(funnels, 'Termine', { source: '', medium: '', campaign: 'FA | VSL | ABO | 090926' }), 'vsl', 'gemeinsamer Termine-Tab + VSL-UTM -> vsl');
assert.equal(funnelForName(funnels, 'FA | VSL | ABO | 090926'), 'vsl', 'Meta-Kampagne mit "VSL" -> vsl');
assert.equal(funnelForName(funnels, 'HW-Show - ABO'), 'live', 'Webinar-Kampagne -> live');

// 2) End-to-End: zwei Leads-Tabs
const H = ['Datum', 'Name', 'E-Mail', 'Telefonnummer', 'UTM Source', 'UTM Medium', 'UTM  Campaign', 'Leads', 'Leads aus Ads', 'Leads aus Organisch', 'Leads aus Newsletter', 'Leads aus Instagram', 'A/B Variante', 'Variante 1', 'Variante 1', 'Variante 2', 'Variante 2'];
const webinar = { title: 'Leads', values: [H, ['2026-08-01 10:00:00 +0000', 'Anna', 'a@x.de', '', 'Kampagne 1  - DACH - Broad Reiten', 'Ich suche Pferdemenschen 2.0', 'HW-Show - ABO', '', '', '', '', '', '', '', '', '', '']] };
const vslTab = { title: 'VSL Leads', values: [H, ['2026-08-01 11:00:00 +0000', 'Bea', 'b@x.de', '', 'FA | VSL | ABO | 090926', 'V1 VSL', 'FA | VSL | ABO | 090926', '', '', '', '', '', '', '', '', '', '']] };

const ds = buildDataset(parseSheets([webinar, vslTab], project), loadScoringConfig(), project);
const anna = ds.leads.find((l) => l.email === 'a@x.de');
const bea = ds.leads.find((l) => l.email === 'b@x.de');
assert.ok(anna && bea, 'beide Leads im Dataset');
assert.equal(anna.funnel, 'live', 'Webinar-Tab-Lead -> live');
assert.equal(bea.funnel, 'vsl', 'VSL-Tab-Lead -> vsl');
assert.equal(bea.sourceType, 'paid', 'VSL-Lead als bezahlt erkannt');

console.log('✓ Alle Funnel-Segmentierungs-Tests bestanden');
console.log('  Anna:', anna.funnel, '| Bea:', bea.funnel);
