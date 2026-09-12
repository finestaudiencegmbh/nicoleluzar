/**
 * Funnel-Segmentierung (z. B. "Live" = Webinar, "VSL"). Ordnet jede Sheet-Zeile
 * und jede Meta-Kampagne einem Funnel zu. Reihenfolge der Signale:
 *   1) Tab-Titel enthält einen titleMatch-Begriff  (z. B. Tab "VSL Leads")
 *   2) sonst: UTM/Kampagnenname enthält einen utmMatch-Begriff (z. B. "vsl")
 *   3) sonst: default-Funnel (z. B. "live")
 * Konfiguriert in config/project.config.json -> funnels.
 */

export function activeFunnels(project) {
  const f = project?.funnels;
  return f && f.enabled ? f : null;
}

const lc = (s) => String(s ?? '').toLowerCase();
const anyIncludes = (hay, needles) => (needles || []).some((n) => hay.includes(lc(n)));

/** Funnel-Key für eine Sheet-Zeile (Tab-Titel hat Vorrang, dann UTM). */
export function funnelForRecord(funnels, tabTitle, utm) {
  if (!funnels) return null;
  const title = lc(tabTitle);
  for (const seg of funnels.segments || []) {
    if (anyIncludes(title, seg.titleMatch)) return seg.key;
  }
  const hay = [utm?.source, utm?.medium, utm?.campaign].map(lc).join(' | ');
  for (const seg of funnels.segments || []) {
    if (anyIncludes(hay, seg.utmMatch)) return seg.key;
  }
  return funnels.default || null;
}

/** Funnel-Key für einen Meta-Kampagnennamen (nur utmMatch). */
export function funnelForName(funnels, name) {
  if (!funnels) return null;
  const hay = lc(name);
  for (const seg of funnels.segments || []) {
    if (anyIncludes(hay, seg.utmMatch)) return seg.key;
  }
  return funnels.default || null;
}
