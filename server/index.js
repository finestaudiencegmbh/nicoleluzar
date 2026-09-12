import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { fetchAllSheets, isConfigured } from './sheets.js';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';
import { getSampleParsed } from './sample-data.js';
import { isSupermetricsConfigured, fetchFbInsights, aggregateFb } from './supermetrics.js';
import { isMetaConfigured, fetchMetaAll } from './meta.js';
import { combineMetaWithLeads } from './combine.js';
import { isChatConfigured, buildContext, chat } from './chat.js';
import { loadProjectConfig, publicProject } from './project.js';
import { activeFunnels } from './funnels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const PROJECT = loadProjectConfig();
// Standard 15 Min: Ansehen/Tab-Wechsel/erneutes Öffnen kommt aus dem Cache und
// kostet keine Meta-Calls (schont das API-Rate-Limit). Der „Aktualisieren"-
// Button (refresh=1) umgeht den Cache und holt immer frische Daten.
const CACHE_TTL = (Number(process.env.CACHE_TTL_SECONDS) || 900) * 1000;

const app = express();
app.use(express.json());

// --- Optionaler Basic-Auth-Schutz -------------------------------------------
const AUTH_USER = process.env.DASHBOARD_USER;
const AUTH_PASS = process.env.DASHBOARD_PASSWORD;
if (AUTH_USER && AUTH_PASS) {
  app.use((req, res, next) => {
    // Health-Check muss ohne Login erreichbar sein (Render/Hoster prüfen ihn
    // ohne Zugangsdaten – sonst schlägt das Deployment fehl).
    if (req.path === '/api/health') return next();
    const hdr = req.headers.authorization || '';
    const [scheme, encoded] = hdr.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [u, p] = Buffer.from(encoded, 'base64').toString().split(':');
      if (u === AUTH_USER && p === AUTH_PASS) return next();
    }
    res.set('WWW-Authenticate', `Basic realm="${PROJECT.shortName || 'Dashboard'}"`);
    return res.status(401).send('Authentifizierung erforderlich.');
  });
}

// --- Daten-Cache (je Zeitraum) ---------------------------------------------
const cache = new Map(); // key -> { at, payload }

async function loadDataset({ refresh = false, from = '', to = '' } = {}) {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_TTL) {
    return hit.payload;
  }
  const cfg = loadScoringConfig();
  let parsed;
  let source;
  if (isConfigured()) {
    const sheets = await fetchAllSheets();
    parsed = parseSheets(sheets, PROJECT);
    source = 'google';
  } else {
    parsed = getSampleParsed();
    source = 'demo';
  }
  const dataset = buildDataset(parsed, cfg, PROJECT);

  // Facebook-Ads-Daten: bevorzugt direkt über die Meta Marketing API,
  // alternativ über Supermetrics. Fehler hier dürfen das Sheet-Dashboard
  // nicht blockieren. Der Zeitraum (from/to) wird an Meta durchgereicht.
  const range = from && to ? { since: from, until: to } : null;
  const metaOn = isMetaConfigured();
  const smOn = isSupermetricsConfigured();
  let fb = { configured: metaOn || smOn, provider: metaOn ? 'meta' : smOn ? 'supermetrics' : null, error: null, totals: null, byDim: null, rows: 0, hierarchy: null, daily: null };
  if (metaOn) {
    try {
      const all = await fetchMetaAll(range);
      const agg = aggregateFb(all.records);
      // Leads für denselben Zeitraum, damit FB-Hierarchie & Leads konsistent sind
      const leadsInRange = filterLeadsByRange(dataset.leads, from, to);
      // Bewertete Umfrage-Zeilen im selben Zeitraum -> Quali-Rate je Kampagne/
      // Anzeigengruppe/Creative in der Hierarchie.
      const surveysInRange = (dataset.quality?.rows || []).filter((r) => {
        if (from && r.day < from) return false;
        if (to && r.day > to) return false;
        return true;
      });
      // Termine/Closings im selben Zeitraum -> €/Termin, €/Close je Ebene.
      const byRange = (arr) => (arr || []).filter((r) => {
        const day = (r.wonAt || '').slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      });
      const combined = combineMetaWithLeads(all, leadsInRange, surveysInRange, byRange(dataset.termine), byRange(dataset.closings), activeFunnels(PROJECT));
      fb = { configured: true, provider: 'meta', error: null, fetchedAt: new Date().toISOString(), ...agg, hierarchy: combined.hierarchy, daily: combined.daily, totals: combined.totals, nonLeadCampaigns: combined.nonLeadCampaigns, uocByDim: combined.uocByDim, dimMeta: combined.dimMeta, dailyByEntity: combined.dailyByEntity };
    } catch (err) {
      console.error('Meta-Fehler:', err.message);
      fb.error = err.message;
    }
  } else if (smOn) {
    try {
      const records = await fetchFbInsights();
      const agg = aggregateFb(records);
      fb = { configured: true, provider: 'supermetrics', error: null, fetchedAt: new Date().toISOString(), ...agg };
    } catch (err) {
      console.error('Supermetrics-Fehler:', err.message);
      fb.error = err.message;
    }
  }

  const payload = {
    source,
    fetchedAt: new Date().toISOString(),
    range: range || null,
    project: publicProject(PROJECT),
    scoring: { weights: cfg.weights, tiers: cfg.tiers },
    fb,
    ...dataset,
  };
  cache.set(key, { at: Date.now(), payload });
  return payload;
}

/** Begrenzt Leads auf [from,to] (YYYY-MM-DD, inklusive). Tagesdatum = UTC,
 *  passend zum im Sheet angezeigten +0000-Zeitstempel. */
function filterLeadsByRange(leads, from, to) {
  if (!from && !to) return leads;
  return leads.filter((l) => {
    const day = (l.wonAt || '').slice(0, 10);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

// --- API --------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, configured: isConfigured(), mode: isConfigured() ? 'google' : 'demo' });
});

app.get('/api/data', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const from = isYmd(req.query.from) ? req.query.from : '';
    const to = isYmd(req.query.to) ? req.query.to : '';
    const payload = await loadDataset({ refresh, from, to });
    res.json(payload);
  } catch (err) {
    console.error('Fehler beim Laden der Daten:', err);
    res.status(500).json({ error: err.message, hint: 'Prüfe Service-Account & Freigabe des Sheets (siehe README).' });
  }
});

app.get('/api/chat/health', (req, res) => {
  res.json({ configured: isChatConfigured() });
});

app.post('/api/chat', async (req, res) => {
  try {
    if (!isChatConfigured()) {
      return res.status(503).json({ error: 'Chatbot nicht konfiguriert (ANTHROPIC_API_KEY fehlt).' });
    }
    const { messages, from = '', to = '' } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages fehlt.' });
    }
    const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const payload = await loadDataset({ from: isYmd(from) ? from : '', to: isYmd(to) ? to : '' });
    const leadsInRange = filterLeadsByRange(payload.leads, isYmd(from) ? from : '', isYmd(to) ? to : '');
    const context = buildContext(payload, leadsInRange);
    const answer = await chat({ messages: messages.slice(-12), context });
    res.json({ answer });
  } catch (err) {
    console.error('Chat-Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Statisches Frontend (Production-Build) ---------------------------------
const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  // Gehashte Assets (index-<hash>.js/.css) dürfen gecacht werden – index.html
  // selbst NICHT: sonst hält der Browser eine alte index.html mit veralteten
  // Asset-Hashes, die nach einem Redeploy nicht mehr existieren -> CSS/JS laden
  // nicht -> ungestyltes Dashboard.
  app.use(express.static(distDir, { index: false }));
  // SPA-Fallback NUR für echte Seiten-Routen (ohne Datei-Endung). Eine fehlende
  // Datei wie /assets/x.css muss sauber 404en statt index.html (text/html)
  // zurückzuliefern – andernfalls scheitert das Styling stillschweigend.
  app.get('*', (req, res, next) => {
    if (path.extname(req.path)) return next(); // fehlende Datei -> Express-404
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) =>
    res
      .type('html')
      .send(`<h1>${PROJECT.name} – API läuft</h1><p>Frontend noch nicht gebaut. Im Dev: <code>npm run dev</code> und <a href="http://localhost:5173">localhost:5173</a> öffnen. Für Production: <code>npm run serve</code>.</p>`)
  );
}

app.listen(PORT, () => {
  const mode = isConfigured() ? 'Google Sheets (live)' : 'DEMO (synthetische Daten)';
  console.log(`\n  ${PROJECT.name} – Server läuft auf  http://localhost:${PORT}`);
  console.log(`  Datenquelle: ${mode}\n`);
});
