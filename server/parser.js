import { DEFAULT_PROJECT } from './project.js';

/**
 * Wandelt die Roh-Zellen aus dem Google Sheet in strukturierte Datensätze um.
 *
 * Das Sheet besteht aus mehreren Tabs/Tabellen. Statt fixe Tab-Namen
 * vorauszusetzen, erkennt der Parser jede Tabelle an ihrer Kopfzeile.
 * Dadurch bleibt er stabil, auch wenn Tabs umbenannt oder verschoben werden.
 */

const norm = (s) =>
  String(s ?? '')
    .replace(/ /g, ' ')
    .trim();

const key = (s) =>
  norm(s)
    .toLowerCase()
    .replace(/[?:.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Prüft eine normalisierte Spalten-Menge gegen eine detect-Definition
 * { all: [...], any: [...] }: alle 'all'-Spalten müssen vorhanden sein UND –
 * falls 'any' gesetzt ist – mindestens eine davon.
 */
function matchDetect(set, detect) {
  if (!detect) return false;
  const all = detect.all || [];
  const any = detect.any || [];
  if (all.length === 0 && any.length === 0) return false;
  const hasAll = all.every((k) => set.has(k));
  const hasAny = any.length ? any.some((k) => set.has(k)) : true;
  return hasAll && hasAny;
}

/** Erkennt anhand einer Kopfzeile, um welchen Tabellentyp es sich handelt. */
function classifyHeader(cells, project) {
  const set = new Set(cells.map(key));
  if (matchDetect(set, project?.sheet?.overview?.detect)) return 'overview';
  if (matchDetect(set, project?.questionnaire?.detect)) return 'tickets';
  if (matchDetect(set, project?.sheet?.termine?.detect)) return 'termine';
  if (matchDetect(set, project?.sheet?.closings?.detect)) return 'closings';
  if (matchDetect(set, project?.sheet?.leads?.detect)) return 'leads';
  return null;
}

function rowToObj(headerCells, row) {
  const obj = {};
  const last = {};
  headerCells.forEach((h, i) => {
    const k = key(h);
    if (!k) return;
    const v = norm(row[i]);
    // Bei doppelten Spaltennamen (z. B. zweimal "UTM Source" im Termine-Tab)
    // gewinnt standardmäßig die ERSTE nicht-leere Angabe.
    if (!(k in obj) || (obj[k] === '' && v !== '')) obj[k] = v;
    // Zusätzlich die LETZTE nicht-leere Angabe je Spalte merken – für Tabs mit
    // zwei UTM-Sätzen, bei denen der rechte "Lead"-Block die Ad-Attribution
    // trägt (Termine: links Buchungsquelle, rechts Lead-UTM). Siehe utmFrom.
    if (v !== '') last[k] = v;
  });
  Object.defineProperty(obj, '__last', { value: last, enumerable: false });
  return obj;
}

/** Wie pickRaw, aber nimmt die LETZTE nicht-leere Angabe je Spalte. */
function pickRawLast(o, keys) {
  const last = o.__last || {};
  for (const k of keys || []) {
    const v = last[k];
    if (v != null && norm(v) !== '') return v;
  }
  return '';
}

function isEmptyRow(row) {
  return !row || row.every((c) => norm(c) === '');
}

function parseDate(s) {
  const v = norm(s);
  if (!v) return null;
  // 1) ISO-Format: "2026-05-26 18:46:08 +0000" / "2026-05-26".
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v.replace(' +0000', 'Z').replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // 2) Deutsches Format (Optin-Leads): "13.7.2026 01:08:37" / "13.07.2026".
  //    Tag.Monat.Jahr, Zeit optional. Der 4-stellige Jahresteil verhindert,
  //    dass Zähl-/Summenzeilen (z. B. "161") fälschlich als Datum gelten.
  //    Wall-Clock wird als UTC interpretiert – konsistent zum +0000-ISO oben
  //    (das Dashboard zeigt Zeiten in UTC 1:1 wie im Sheet).
  const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day, Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

const normEmail = (s) => norm(s).toLowerCase();

/**
 * Zerlegt ein Tab (2D-Array) in einzelne Tabellen. Ein Tab kann mehrere
 * untereinander gestapelte Tabellen enthalten (z. B. die Anzeigengruppen-
 * Übersicht mit mehreren Kampagnen).
 */
function* iterateTables(rows, project) {
  let header = null;
  let type = null;
  let body = [];
  const flush = () => {
    if (header && body.length) return { header, type, body };
    return null;
  };
  for (const row of rows) {
    const t = classifyHeader(row.map(norm).filter(Boolean).length >= 2 ? row : [], project);
    if (t) {
      const prev = flush();
      if (prev) yield prev;
      header = row;
      type = t;
      body = [];
      continue;
    }
    if (header) {
      if (isEmptyRow(row)) {
        const prev = flush();
        if (prev) yield prev;
        header = null;
        type = null;
        body = [];
      } else {
        body.push(row);
      }
    }
  }
  const last = flush();
  if (last) yield last;
}

const num = (s) => {
  const v = norm(s).replace(/[^\d,.-]/g, '');
  if (!v) return null;
  // deutsches Format: 1.030,11 -> 1030.11
  const n = parseFloat(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function parseOverviewRow(o, fields) {
  const adset = norm(pickRaw(o, fields.key));
  if (!adset) return null;
  return {
    status: norm(pickRaw(o, fields.status)),
    adset,
    adspend: num(pickRaw(o, fields.adspend)),
    clicks: num(pickRaw(o, fields.clicks)),
    cpc: num(pickRaw(o, fields.cpc)),
    cvrStart: num(pickRaw(o, fields.cvrStart)),
    leads: num(pickRaw(o, fields.leads)),
  };
}

/** Erster nicht-leerer Roh-Wert aus einer Liste möglicher Spalten-Schlüssel. */
function pickRaw(o, keys) {
  for (const k of keys || []) {
    const v = o[k];
    if (v != null && norm(v) !== '') return v;
  }
  return '';
}

function parseLeadRow(o, fields) {
  const wonAt = parseDate(pickRaw(o, fields.at));
  if (!wonAt) return null; // Zähl-/Summenzeilen ohne gültiges Datum überspringen
  return {
    wonAt,
    firstName: norm(pickRaw(o, fields.firstName)) || norm(pickRaw(o, fields.name)),
    lastName: norm(pickRaw(o, fields.lastName)),
    email: normEmail(pickRaw(o, fields.email)),
    utm: {
      source: norm(pickRaw(o, fields.utmSource)),
      medium: norm(pickRaw(o, fields.utmMedium)),
      campaign: norm(pickRaw(o, fields.utmCampaign)),
      term: norm(pickRaw(o, fields.utmTerm)),
    },
    ticketAt: parseDate(pickRaw(o, fields.ticketColumn)),
  };
}

function parseTermineRow(o, fields, preferLastUtm = false) {
  const appointmentAt = parseDate(pickRaw(o, fields.appointmentAt));
  const at = parseDate(pickRaw(o, fields.at));
  // Nur echte Termine (mit vereinbartem Gesprächs-Datum) – Summen-/Testzeilen raus.
  if (!appointmentAt) return null;
  // UTM-Quelle: bei zwei Sätzen im Tab optional den rechten "Lead"-Block nehmen
  // (echte Ad-Attribution) statt der Buchungsquelle links (utmFrom: "lead").
  const pickUtm = (keys) => (preferLastUtm ? pickRawLast(o, keys) : pickRaw(o, keys));
  return {
    wonAt: at || appointmentAt,
    appointmentAt,
    name: norm(pickRaw(o, fields.name)),
    email: normEmail(pickRaw(o, fields.email)),
    phone: norm(pickRaw(o, fields.phone)),
    utm: {
      source: norm(pickUtm(fields.utmSource)),
      medium: norm(pickUtm(fields.utmMedium)),
      campaign: norm(pickUtm(fields.utmCampaign)),
      term: '',
    },
  };
}

/**
 * Closings-Tab: Einzelzeile = ein Verkauf (mit Datum Kauf + Umsatz). Die
 * Zeile OHNE Datum Kauf, aber mit Closings-/Cash-Collect-Werten ist die
 * Summenzeile -> als { summary: true, ... } zurückgeben.
 */
function parseClosingRow(o, fields) {
  const at = parseDate(pickRaw(o, fields.at));
  if (at) {
    return {
      summary: false,
      wonAt: at,
      name: norm(pickRaw(o, fields.name)),
      email: normEmail(pickRaw(o, fields.email)),
      phone: norm(pickRaw(o, fields.phone)),
      land: norm(pickRaw(o, fields.land)),
      produkt: norm(pickRaw(o, fields.produkt)),
      revenueNet: num(pickRaw(o, fields.revenueNet)),
      revenueGross: num(pickRaw(o, fields.revenueGross)),
      cashCollectNet: num(pickRaw(o, fields.ccNet)),
      cashCollectGross: num(pickRaw(o, fields.ccGross)),
      utm: {
        source: norm(pickRaw(o, fields.utmSource)),
        medium: norm(pickRaw(o, fields.utmMedium)),
        campaign: norm(pickRaw(o, fields.utmCampaign)),
        term: '',
      },
    };
  }
  // Keine Kaufzeile -> evtl. Summenzeile (Cash Collect / Closings-Anzahl)?
  const cashPaid = num(pickRaw(o, fields.summaryCashCollectPaid));
  const cashOrg = num(pickRaw(o, fields.summaryCashCollectOrganisch));
  const count = num(pickRaw(o, fields.summaryCount));
  if (cashPaid != null || cashOrg != null || count != null) {
    return {
      summary: true,
      cashCollectPaid: cashPaid,
      cashCollectOrganisch: cashOrg,
      umsatzPaid: num(pickRaw(o, fields.summaryUmsatzPaid)),
      umsatzOrganisch: num(pickRaw(o, fields.summaryUmsatzOrganisch)),
      closingsCount: count,
    };
  }
  return null;
}

function parseTicketRow(o, project) {
  const q = project.questionnaire || {};
  const f = q.fields || {};
  const at = parseDate(pickRaw(o, f.at));
  const email = normEmail(pickRaw(o, f.email));
  if (!at && !email) return null;
  const answers = {};
  for (const [key, cols] of Object.entries(q.answers || {})) {
    answers[key] = norm(pickRaw(o, cols));
  }
  return {
    at,
    firstName: norm(pickRaw(o, f.firstName)),
    lastName: norm(pickRaw(o, f.lastName)),
    email,
    emailTypeform: normEmail(pickRaw(o, f.emailTypeform)),
    phone: norm(pickRaw(o, f.phone)),
    answers,
    // UTM Medium des Fragebogens (für die Ad-Aufschlüsselung der Lead-Qualität).
    utmMedium: norm(pickRaw(o, f.utmMedium)) || norm(o['utm_medium']),
    // Volles UTM (Source=Anzeigengruppe, Medium=Creative, Campaign=Kampagne) –
    // gleiche Struktur wie der Leads-Tab, für die Attribution in die Hierarchie.
    utm: {
      source: norm(pickRaw(o, f.utmSource)) || norm(o['utm_source']),
      medium: norm(pickRaw(o, f.utmMedium)) || norm(o['utm_medium']),
      campaign: norm(pickRaw(o, f.utmCampaign)) || norm(o['utm_campaign']),
      term: norm(o['utm_term']),
    },
  };
}

/**
 * Hauptfunktion: bekommt die Tabs als [{title, values}] und liefert
 * { leads, tickets, overview, warnings }.
 */
export function parseSheets(sheets, project = DEFAULT_PROJECT) {
  const leads = [];
  const tickets = [];
  const overview = [];
  const termine = [];
  const closings = [];
  let closingsSummary = null;
  const warnings = [];
  const seenTickets = new Set();
  const overviewFields = project.sheet?.overview?.fields || DEFAULT_PROJECT.sheet.overview.fields;
  const leadFields = project.sheet?.leads?.fields || DEFAULT_PROJECT.sheet.leads.fields;
  const termineFields = project.sheet?.termine?.fields || DEFAULT_PROJECT.sheet.termine.fields;
  const closingFields = project.sheet?.closings?.fields || DEFAULT_PROJECT.sheet.closings.fields;
  // utmFrom: "lead"/"last" -> UTM aus dem rechten "Lead"-Block ziehen (Termine).
  const terminePreferLast = ['lead', 'last'].includes(String(project.sheet?.termine?.utmFrom || '').toLowerCase());

  for (const sheet of sheets) {
    const rows = sheet.values || [];
    for (const table of iterateTables(rows, project)) {
      for (const row of table.body) {
        const o = rowToObj(table.header, row);
        if (table.type === 'overview') {
          const r = parseOverviewRow(o, overviewFields);
          if (r) overview.push(r);
        } else if (table.type === 'termine') {
          const r = parseTermineRow(o, termineFields, terminePreferLast);
          if (r) termine.push(r);
        } else if (table.type === 'closings') {
          const r = parseClosingRow(o, closingFields);
          if (r && r.summary) closingsSummary = r;
          else if (r) closings.push(r);
        } else if (table.type === 'leads') {
          const r = parseLeadRow(o, leadFields);
          if (r) leads.push(r);
        } else if (table.type === 'tickets') {
          const r = parseTicketRow(o, project);
          if (!r) continue;
          // Dedupe (das Sheet enthält teils zwei Ticket-Tabs)
          const dk = `${r.email}|${r.at || ''}`;
          if (seenTickets.has(dk)) continue;
          seenTickets.add(dk);
          tickets.push(r);
        }
      }
    }
  }

  return { leads, tickets, overview, termine, closings, closingsSummary, warnings };
}

export const _internal = {
  classifyHeader: (cells, project = DEFAULT_PROJECT) => classifyHeader(cells, project),
  key,
  num,
  parseDate,
  iterateTables: (rows, project = DEFAULT_PROJECT) => iterateTables(rows, project),
};
