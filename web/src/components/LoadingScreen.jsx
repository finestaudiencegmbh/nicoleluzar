import React, { useEffect, useRef, useState } from 'react';

const ETA_KEY = 'nl-load-eta';
const DEFAULT_ETA = 8000; // ms, Startwert bevor eine echte Dauer bekannt ist
const MIN_ETA = 3000;
const MAX_ETA = 45000;

function readEta() {
  try {
    const v = Number(localStorage.getItem(ETA_KEY));
    if (v && Number.isFinite(v)) return Math.min(MAX_ETA, Math.max(MIN_ETA, v));
  } catch { /* localStorage evtl. blockiert */ }
  return DEFAULT_ETA;
}

const fmtSec = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

/**
 * Vollbild-Ladeanzeige mit Fortschrittsbalken. Da der Server die einzelnen
 * Schritte (Google Sheet, Meta-API) nicht in Echtzeit meldet und der größte
 * Teil der Wartezeit auf einen evtl. schlafenden Server entfällt, zeigt der
 * Balken die tatsächlich verstrichene Zeit gegen eine Schätzung (ETA), die aus
 * der letzten echten Ladedauer gelernt wird – so wird die Erwartung pro
 * Umgebung mit jeder Ladung genauer.
 */
export default function LoadingScreen({ accent = '#ec761e', title = 'Dashboard', logo = '/logo.svg' }) {
  const etaRef = useRef(readEta());
  const startRef = useRef(performance.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(performance.now() - startRef.current), 90);
    return () => clearInterval(id);
  }, []);

  const eta = etaRef.current;
  const frac = elapsed / eta;
  // bis ETA linear auf 90 %, danach langsames Kriechen Richtung 98 %
  let pct = frac <= 1 ? frac * 90 : 90 + Math.min(8, (frac - 1) * 18);
  pct = Math.max(2, Math.min(98, pct));

  const stage = pct < 33 ? 'Google Sheet wird geladen …'
    : pct < 68 ? 'Werbedaten von Facebook werden abgerufen …'
      : 'Auswertung wird berechnet …';
  const remaining = frac < 1 ? `noch ca. ${Math.max(1, Math.ceil((eta - elapsed) / 1000))} s` : 'gleich fertig …';

  return (
    <div className="load-screen">
      {/* futuristischer Hintergrund: driftende Glows + feines Raster */}
      <div className="load-bg" aria-hidden="true">
        <span className="load-orb load-orb-1" />
        <span className="load-orb load-orb-2" />
        <span className="load-grid" />
      </div>
      <div className="load-box">
        <div className="load-logo-wrap" aria-hidden="true">
          <span className="load-ring" />
          <span className="load-ring load-ring-2" />
          <span className="load-pulse" />
          <img className="load-logo" src={logo} alt="" width="56" height="56" />
        </div>
        <div className="load-title">{title}</div>
        <div className="load-stage">{stage}</div>
        <div className="load-track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="load-fill" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${accent}, ${accent})` }} />
        </div>
        <div className="load-meta">
          <span>{fmtSec(elapsed)}</span>
          <span>{remaining}</span>
        </div>
      </div>
    </div>
  );
}

/** Nach erfolgreichem Laden die echte Dauer (nur „echte", nicht gecachte
 *  Abrufe) als geglättete ETA merken, damit die nächste Anzeige genauer ist. */
export function recordLoadDuration(ms) {
  if (!ms || ms < 1500) return; // schnelle Cache-Treffer verfälschen die Schätzung
  try {
    const prev = Number(localStorage.getItem(ETA_KEY));
    const next = prev && Number.isFinite(prev) ? prev * 0.4 + ms * 0.6 : ms;
    localStorage.setItem(ETA_KEY, String(Math.round(Math.min(MAX_ETA, Math.max(MIN_ETA, next)))));
  } catch { /* localStorage evtl. blockiert */ }
}
