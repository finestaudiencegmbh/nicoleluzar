# Neues Dashboard aufsetzen (Onboarding)

Diese Codebasis ist ein **generisches Lead-/Kampagnen-Dashboard**. Der
funktionierende Kern (Meta-Marketing-API in `server/meta.js`, UTM-Attribution in
`server/combine.js`, die SVG-Charts) wird **nicht** angefasst – ein neues Projekt
entsteht nur durch **Konfiguration**.

Pro Projekt gibt es genau drei Stellschrauben im Ordner `config/`:

| Datei | Zweck |
|-------|-------|
| `project.config.json` | **Hauptdatei** – Projektname, Branding, Feature-Flags, Sheet-Spalten-Mapping |
| `scoring.json` | Lead-Qualitäts-Scoring (nur relevant wenn `hasQuality: true`) |
| `campaigns.json` | Welche Kampagnen als Lead-Kampagnen zählen (CPL-Berechnung) |

Dazu kommen das **Logo** (`web/public/logo.svg`) und die **Umgebungsvariablen**
(`.env` bzw. Hosting-Secrets).

---

## Schritt für Schritt

### 1. `config/project.config.json` anpassen

```jsonc
{
  "name": "Mein Workshop",          // voller Name (Seitentitel, Chatbot, Login-Realm)
  "shortName": "Workshop",          // kurz, für Sidebar/Logo-Zeile
  "subtitle": "Veranstalter · Datum", // optionale Subline (leer = aus)

  "branding": {
    "accent": "#cb997e",            // Akzentfarbe (Hex) – KPIs, Buttons, Graphen
    "logo": "/logo.svg"             // Pfad zum Logo in web/public/
  },

  "features": {
    "hasTickets": false,            // Ticket-Logik (€/Ticket, CVR Ticket, VIP …)
    "hasQuality": false             // Fragebogen-/Scoring-System (Quali-Rate, Tier …)
  },

  "ticketLabel": { "singular": "VIP-Ticket", "plural": "VIP-Tickets" },

  "questionnaire": { /* nur nötig wenn hasTickets/hasQuality true – siehe unten */ }
}
```

**Feature-Flags – das Wichtigste:**

- `hasTickets: false` → **alle** ticketbezogenen KPIs/Spalten verschwinden
  sauber: VIP-Tickets-Karten, `€/Ticket`, `CVR Ticket`, `Kosten/Ticket`, die
  VIP-Spalte der Leadliste, Ticket-Kacheln der Kampagnen-Ansicht, die
  „Kosten/Ticket"-Kurve im Grafik-Panel und die Ticket-Felder im Chatbot.
- `hasQuality: false` → **das gesamte** Fragebogen-/Scoring-System verschwindet:
  Lead-Qualitäts-KPIs, `Quali-Rate`, `Ø Quali`, Tier-Verteilung, Quality-Badges,
  Fragebogen-Filter, Fragebogen-Antworten in der Lead-Detailansicht und die
  Qualitäts-Kurve/Felder in Grafik & Chatbot.

Beide Flags sind unabhängig. Beide `false` = schlankes Lead-/Spend-Dashboard.

### 2. Fragebogen-Mapping (nur bei `hasQuality`/`hasTickets: true`)

Das Ticket-/Fragebogen-Tab des Sheets wird über seine **Spaltenüberschriften**
erkannt und gemappt (früher hart im Code, jetzt in `project.config.json ->
questionnaire`). Schlüssel sind **normalisiert**: kleingeschrieben, ohne `? : .`,
Mehrfach-Leerzeichen kollabiert. Pro Feld dürfen mehrere Spalten-Varianten
stehen (die erste nicht-leere gewinnt).

```jsonc
"questionnaire": {
  "detect": {                       // woran der Ticket-Tab erkannt wird
    "any": ["monatliches einkommen", "immobilien im besitz"],
    "all": ["teilgenommen am", "vorname"]
  },
  "fields": {                       // Stammdaten-Spalten
    "at": ["teilgenommen am"],
    "firstName": ["vorname"],
    "lastName": ["nachname"],
    "email": ["e-mail (funnelcockpit)", "e-mail (typeform)", "e-mail"],
    "emailTypeform": ["e-mail (typeform)"],
    "phone": ["handynummer"]
  },
  "answers": {                      // Fragebogen-Antworten -> scoring.json-Dimensionen
    "employment": ["angestellt selbstständig oder unternehmer"],
    "income": ["monatliches einkommen"],
    "realEstate": ["immobilien im besitz"],
    "invested": ["geld investiert in den vermögensaufbau wenn ja wie viel"],
    "relationship": ["beziehungsstand"],
    "challenge": ["größte herausforderung im vermögensaufbau"],
    "expectation": ["was erhoffst du dir von den 4 abenden"]
  },
  "leadTicketColumn": ["vip-ticket geholt am"]  // Spalte im Leads-Tab, die ein Ticket markiert
}
```

Die Antwort-Schlüssel (`income`, `invested`, `realEstate`, `employment`) müssen zu
den in `scoring.json` verwendeten Dimensionen passen.

### 3. `scoring.json` (nur bei `hasQuality: true`)

Zwei Bewertungsmodelle (per `model`):

- **`model: "criteria"`** – deterministisches KO-/Kriterien-Zählmodell (Dropdown-
  Fragebögen). `ko` = Regeln, die sofort Tier D setzen; `aCriteria` = Kriterien,
  die gezählt werden (`tierCounts.A`=alle → A, `tierCounts.B` → B, sonst C). Jede
  Regel: `{ "field": "<answers-Schlüssel>", "equals": ["exakter Wert", …] }`,
  Vergleich exakt nach Trim. `validFrom` (YYYY-MM-DD) bewertet nur Zeilen ab
  Stichtag. Jede Fragebogen-Zeile ist die eigene Auswertungseinheit (eigenes
  Datum + UTM Medium) und erscheint im Reiter **„Qualität"** (Verteilung,
  Tagestrend, Ad-Breakdown je UTM Medium).
- **ohne `model`** – gewichtetes 0..100-Modell (Freitext-Antworten, Gewichte je
  Dimension + Tier-Schwellen); Qualität hängt an den Leads (Join über E-Mail).

Die `answers`-Schlüssel müssen zu `project.config.json -> questionnaire.answers`
passen. Bei `hasQuality: false` wird die Datei ignoriert.

### 4. `campaigns.json`

Steuert, welche Kampagnen als **Lead-Kampagnen** zählen (deren Spend fließt in
CPL/Kosten-pro-Ticket). Traffic-/Awareness-Kampagnen werden über das Meta-Ziel
automatisch ausgeschlossen; `overrides` für manuelle Korrekturen. `organicPatterns`
definiert, was als organische Quelle gilt.

### 5. Logo

`web/public/logo.svg` durch das Projekt-Logo ersetzen (gleicher Dateiname, oder
Pfad in `project.config.json -> branding.logo` anpassen).

### 6. Umgebungsvariablen setzen

Lokal in `.env` (siehe `.env.example`), beim Hosting als Secrets (siehe
`render.yaml`). Server neu starten – `project.config.json` wird beim Start gelesen.

### 7. Prüfen

```bash
npm install
npm test          # *.test.mjs müssen grün sein
npm run dev       # lokal ansehen (http://localhost:5173)
```

Ohne Google-Anbindung startet das Dashboard automatisch im **Demo-Modus** mit
synthetischen Daten.

---

## Umgebungsvariablen (vollständig)

### Google Sheets (Datenquelle)

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `SPREADSHEET_ID` | ja* | ID des Tracking-Sheets (in der URL zwischen `/d/` und `/edit`). Ohne diese → Demo-Modus. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ja* | Kompletter Service-Account-Key als **eine Zeile** (ideal fürs Hosting). Hat Vorrang vor der Datei. |
| `GOOGLE_APPLICATION_CREDENTIALS` | alternativ | Pfad zur Service-Account-JSON-Datei (lokal). **Nie committen.** |

\* Für echte Daten: `SPREADSHEET_ID` **und** eine der beiden Google-Credentials-Varianten.
Das Service-Account-E-Mail muss als Betrachter aufs Sheet eingeladen sein.

### Meta Marketing API (Facebook-Ads-Daten)

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `META_ACCESS_TOKEN` | optional | Access-Token mit Berechtigung `ads_read`. **Geheim.** |
| `META_AD_ACCOUNT_ID` | optional | Werbekonto, Format `act_…`. |
| `META_API_VERSION` | optional | z. B. `v21.0` (Default). |
| `META_LOOKBACK_DAYS` | optional | Zeitfenster in Tagen (Default 90). |

Ohne Meta-Anbindung läuft das Dashboard weiter (Adspend dann aus dem Sheet,
sofern vorhanden). Alternativ Supermetrics: `SUPERMETRICS_API_KEY`,
`SUPERMETRICS_DS_ACCOUNTS`, `SUPERMETRICS_DS_USER`, optional
`SUPERMETRICS_QUERY_JSON` (siehe `.env.example`).

### Dashboard-Login (Passwortschutz)

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `DASHBOARD_USER` | empfohlen** | Basic-Auth-Benutzername. |
| `DASHBOARD_PASSWORD` | empfohlen** | Basic-Auth-Passwort. |

\*\* Beim **Hosting Pflicht** – die App enthält personenbezogene Daten (Namen,
E-Mails, Telefonnummern) und darf nie offen im Netz stehen. Beide leer = kein Login
(nur lokal vertretbar).

### KI-Chatbot (optional)

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `ANTHROPIC_API_KEY` | optional | Anthropic-API-Key für den Analyse-Assistenten. Leer = Chat aus. |

### Server (optional)

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `PORT` | 3000 | Server-Port. |
| `CACHE_TTL_SECONDS` | 900 | Cache-Dauer der Sheet-/Meta-Daten in Sekunden. |
