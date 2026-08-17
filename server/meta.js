/**
 * Facebook/Meta Marketing API – holt Ad-Insights direkt über den Graph-API-
 * Access-Token. Liefert:
 *   - records:  Placement-Ebene (Ad × publisher_platform × platform_position)
 *               für die bestehende Dimensions-Aggregation (aggregateFb)
 *   - entities: Kennzahlen je Ad inkl. IDs + Hierarchie + INDIVIDUELL
 *               ausgehende Klicks/CTR/Klickpreis (unique_outbound_*)
 *   - daily:    täglicher Ad-Spend/Impressionen/Klicks (für den Zeitgraphen)
 *   - status:   effective_status je Kampagne und Anzeigengruppe (aktiv?)
 *
 * Benötigte .env:
 *   META_ACCESS_TOKEN   – Access-Token mit ads_read
 *   META_AD_ACCOUNT_ID  – Werbekonto, z. B. act_367913946654819
 * Optional:
 *   META_API_VERSION    – Graph-API-Version (Default v21.0)
 *   META_LOOKBACK_DAYS  – Zeitfenster in Tagen (Default 90)
 */

const GRAPH = 'https://graph.facebook.com';

export function isMetaConfigured() {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
}

const ymd = (d) => d.toISOString().slice(0, 10);

function normAccount(id) {
  const s = String(id || '').trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

/** Position lesbar machen (z. B. "feed", "instagram_stories" -> "instagram stories"). */
function positionLabel(position) {
  return String(position || '').trim().replace(/_/g, ' ');
}

/** Meta liefert action-basierte Felder als Array [{action_type, value}]. Summe der Werte. */
function actionSum(field, type = 'outbound_click') {
  if (!Array.isArray(field)) return 0;
  let sum = 0;
  for (const a of field) {
    if (!type || a.action_type === type) sum += Number(a.value) || 0;
  }
  return sum;
}

function cfg() {
  return {
    token: process.env.META_ACCESS_TOKEN,
    account: normAccount(process.env.META_AD_ACCOUNT_ID),
    version: process.env.META_API_VERSION || 'v21.0',
    lookback: Number(process.env.META_LOOKBACK_DAYS) || 90,
  };
}

function dateRange(lookback) {
  const end = new Date();
  const start = new Date(end.getTime() - lookback * 86400000);
  return { since: ymd(start), until: ymd(end) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Rate-Limit-Codes von Meta (4 = App-Limit, 17 = User-Limit, 613 = Custom-Limit)
const RATE_LIMIT_CODES = new Set([4, 17, 613, 80000, 80004]);

/** Generischer paginierter GET gegen die Graph API, mit Retry bei Rate-Limit. */
async function graphGet(url) {
  const out = [];
  let next = url;
  let guard = 0;
  while (next && guard < 60) {
    guard += 1;
    let json = null;
    // bis zu 3 Versuche bei Rate-Limit (Code 4 etc.) mit ansteigender Wartezeit
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(next);
      json = await res.json().catch(() => null);
      if (!json) throw new Error(`Meta: unerwartete Antwort (HTTP ${res.status})`);
      if (json.error && RATE_LIMIT_CODES.has(json.error.code)) {
        if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
      }
      break;
    }
    if (json.error) {
      const e = json.error;
      throw new Error(`Meta-Fehler: ${e.message}${e.code ? ` (Code ${e.code})` : ''}`);
    }
    for (const row of json.data || []) out.push(row);
    next = json.paging?.next || null;
  }
  return out;
}

function insightsUrl({ account, version, token }, extra) {
  const params = new URLSearchParams({ access_token: token, limit: '500', ...extra });
  return `${GRAPH}/${version}/${account}/insights?${params.toString()}`;
}

/** Placement-Ebene (für die Dimensions-Tabellen Kampagne/Anzeigengruppe/Creative/Placement). */
async function fetchPlacementRecords(c, range) {
  const rows = await graphGet(
    insightsUrl(c, {
      level: 'ad',
      fields: 'campaign_name,adset_name,ad_name,spend,impressions,clicks,reach',
      breakdowns: 'publisher_platform,platform_position',
      time_range: JSON.stringify(range),
    })
  );
  return rows.map((r) => ({
    campaign: String(r.campaign_name ?? '').trim(),
    adset: String(r.adset_name ?? '').trim(),
    creative: String(r.ad_name ?? '').trim(),
    platform: String(r.publisher_platform ?? '').trim(),
    placement: positionLabel(r.platform_position),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    reach: Number(r.reach) || 0,
  }));
}

/** Kennzahlen je Ad inkl. IDs und individuell ausgehender Metriken. */
async function fetchEntities(c, range) {
  const rows = await graphGet(
    insightsUrl(c, {
      level: 'ad',
      fields:
        'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,cpm,unique_outbound_clicks,unique_outbound_clicks_ctr,cost_per_unique_outbound_click',
      time_range: JSON.stringify(range),
      time_increment: 'all_days',
    })
  );
  return rows.map((r) => ({
    campaignId: r.campaign_id,
    campaign: String(r.campaign_name ?? '').trim(),
    adsetId: r.adset_id,
    adset: String(r.adset_name ?? '').trim(),
    adId: r.ad_id,
    creative: String(r.ad_name ?? '').trim(),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    cpm: Number(r.cpm) || 0,
    // INDIVIDUELL ausgehende Klicks (unique_outbound_clicks)
    uniqueOutboundClicks: actionSum(r.unique_outbound_clicks),
    uniqueOutboundCtr: actionSum(r.unique_outbound_clicks_ctr), // in % (action-Wert)
    costPerUniqueOutboundClick: actionSum(r.cost_per_unique_outbound_click),
  }));
}

/** Täglicher Spend/Impressionen/Klicks (Konto-Ebene) für den Zeitgraphen. */
async function fetchDaily(c, range) {
  const rows = await graphGet(
    insightsUrl(c, {
      level: 'account',
      fields: 'spend,impressions,clicks',
      time_range: JSON.stringify(range),
      time_increment: '1',
    })
  );
  return rows
    .map((r) => ({
      date: r.date_start,
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Tägliche Kennzahlen JE WERBEANZEIGE inkl. Plattform-Split – Basis für die
 * "Grafik"-Ansicht (Zeitreihen je Kampagne/Anzeigengruppe/Creative mit
 * überlagerbaren KPIs). time_increment '1' = pro Tag, breakdowns =
 * publisher_platform (Facebook/Instagram/…) für den Ad-Spend pro Plattform.
 */
async function fetchDailyEntities(c, range) {
  const rows = await graphGet(
    insightsUrl(c, {
      level: 'ad',
      fields: 'campaign_name,adset_name,ad_name,spend,impressions,clicks,unique_outbound_clicks',
      breakdowns: 'publisher_platform',
      time_range: JSON.stringify(range),
      time_increment: '1',
    })
  );
  return rows.map((r) => ({
    date: r.date_start,
    campaign: String(r.campaign_name ?? '').trim(),
    adset: String(r.adset_name ?? '').trim(),
    creative: String(r.ad_name ?? '').trim(),
    platform: String(r.publisher_platform ?? '').trim(),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    uoc: actionSum(r.unique_outbound_clicks),
  }));
}

// Ohne effective_status-Filter liefert die Graph API ARCHIVIERTE Entitäten NICHT
// mit. Solche (im Zeitraum gelaufenen) Ads hätten dann einen unbekannten Status
// und würden im "Nur aktive"-Modus fälschlich angezeigt. Darum alle Status
// explizit anfordern.
const STATUS_ALL = {
  campaigns: ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES'],
  adsets: ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'],
  ads: ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'ADSET_PAUSED', 'CAMPAIGN_PAUSED', 'DISAPPROVED', 'PENDING_REVIEW', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'IN_PROCESS', 'WITH_ISSUES'],
};

/** effective_status je Kampagne (+objective), Anzeigengruppe und Werbeanzeige. */
async function fetchStatus(c) {
  // Mit Status-Filter (inkl. archiviert). Schlägt der Filter fehl, ohne Filter
  // erneut versuchen – damit ein Problem nie den kompletten Status verwirft.
  const getAll = async (edge, fields) => {
    const base = `${GRAPH}/${c.version}/${c.account}/${edge}?fields=${fields}&limit=500&access_token=${c.token}`;
    try {
      return await graphGet(`${base}&effective_status=${encodeURIComponent(JSON.stringify(STATUS_ALL[edge]))}`);
    } catch {
      try { return await graphGet(base); } catch { return []; }
    }
  };
  const camps = await getAll('campaigns', 'name,effective_status,objective');
  const adsets = await getAll('adsets', 'name,effective_status,campaign_id');
  const ads = await getAll('ads', 'name,effective_status');
  const isActive = (s) => s === 'ACTIVE';
  const campaignStatus = {};
  for (const x of camps) {
    campaignStatus[String(x.name).trim()] = {
      status: x.effective_status,
      active: isActive(x.effective_status),
      objective: x.objective || null,
    };
  }
  const adsetStatus = {};
  for (const x of adsets) adsetStatus[String(x.name).trim()] = { status: x.effective_status, active: isActive(x.effective_status) };
  const adStatus = {};
  for (const x of ads) adStatus[String(x.name).trim()] = { status: x.effective_status, active: isActive(x.effective_status) };
  return { campaignStatus, adsetStatus, adStatus };
}

/** Holt alle Meta-Daten in einem Rutsch. Optional mit explizitem Zeitraum. */
export async function fetchMetaAll(customRange) {
  if (!isMetaConfigured()) return null;
  const c = cfg();
  const range = customRange?.since && customRange?.until ? customRange : dateRange(c.lookback);
  const [records, entities, daily, dailyEntities, status] = await Promise.all([
    fetchPlacementRecords(c, range),
    fetchEntities(c, range),
    fetchDaily(c, range),
    fetchDailyEntities(c, range).catch(() => []),
    fetchStatus(c).catch(() => ({ campaignStatus: {}, adsetStatus: {}, adStatus: {} })),
  ]);
  return { records, entities, daily, dailyEntities, ...status, range };
}

/** Rückwärtskompatibel: nur die Placement-Records (für aggregateFb). */
export async function fetchMetaInsights() {
  const all = await fetchMetaAll();
  return all ? all.records : null;
}

export const _internal = { normAccount, positionLabel, actionSum };
