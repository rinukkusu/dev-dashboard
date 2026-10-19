# Dev-Dashboard

Lokales Dashboard für Jira Data Center + Azure DevOps. Ein kleiner Bun-Server fragt regelmäßig deine
PRs und Sprint-Tickets ab, vergleicht sie mit dem letzten Stand und schickt jede Neuerung per
WebSocket direkt an offene Tabs – inklusive Benachrichtigungston. Läuft lokal oder in Docker.
Laufzeit-Abhängigkeiten: keine (nur Bun).

Alternativ gibt es weiterhin den statischen Modus: ein Lauf schreibt `out/dashboard.html`, z. B. per Cron.

**Was du siehst**

- **Zu tun**: Review angefragt, Reviewer wartet/lehnt ab, offene Kommentar-Threads, Merge-Konflikte,
  unbeantwortetes Ticket-Feedback (z. B. vom Test), „PR gemerged, Ticket noch nicht weitergeschoben“,
  „bereit zum Mergen“.
- **Änderungen**: was *andere* seit dem letzten Lauf getan haben (Votes, Kommentare, Statuswechsel,
  neue Review-Anfragen). Bleibt 48 h im Log. „Alles gesehen“ merkt sich der Browser; die Anzahl
  ungelesener Einträge steht im Tab-Titel, praktisch als angepinnter Tab. Kommt eine neue Änderung
  rein, spielt ein kurzer Ton (abschaltbar über 🔔; Browser erlauben Ton erst nach einem Klick auf
  die Seite, bis dahin steht dort „Klick zum Aktivieren“).
- **Meine PRs / Reviews / Tickets**, verknüpft über den Ticket-Key in PR-Titel oder Branchname.

## Einrichten

```sh
cp .env.example .env # ausfüllen
```

**Docker (empfohlen)**

```sh
docker compose pull && docker compose up -d   # fertiges Image von ghcr.io → http://localhost:3000
docker compose up -d --build                  # oder selbst aus dem Quellcode bauen
docker compose logs -f
```

Ohne das Repo zu klonen reichen zwei Dateien:

```sh
mkdir dev-dashboard && cd dev-dashboard
curl -fsSLO https://raw.githubusercontent.com/rinukkusu/dev-dashboard/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/rinukkusu/dev-dashboard/main/.env.example -o .env
# .env ausfüllen, dann:
docker compose pull && docker compose up -d
```

Images (amd64 + arm64) baut GitHub Actions: `main` → `ghcr.io/rinukkusu/dev-dashboard:latest`,
Tag `v1.2.3` → `:1.2.3`, `:1.2`, `:1` plus GitHub-Release.

Der Port ist nur an `127.0.0.1` gebunden – die Seite zeigt interne Daten und hat keinen Login.
Ist 3000 schon belegt, in der `.env` einfach `PORT` ändern.
Der Zustand (Änderungslog) liegt im Volume `data` und überlebt Neustarts. Hängt Jira/ADO hinter
einer Firmen-CA, das Zertifikat mounten und `NODE_EXTRA_CA_CERTS` setzen (siehe `compose.yaml`).
Für VPN-only-Hosts muss Docker Desktop durchs VPN kommen (meist automatisch).

**Ohne Docker**

```sh
bun run serve        # Live-Server → http://localhost:3000
bun install          # nur für Typecheck nötig
```

Endpunkte: `/` Dashboard, `/ws` WebSocket, `/api/state` aktueller Stand als JSON,
`POST /api/refresh` sofort abrufen (Button „Jetzt aktualisieren“), `/healthz`.

**Tokens**

- Jira DC: Profil → *Personal Access Tokens* (ab Jira 8.14). Wird als `Bearer` gesendet.
- Azure DevOps: *User settings → Personal access tokens*, Scope **Code (Read)** reicht.

Erst nur eine Quelle? Einfach die URL der anderen leer lassen.

Zum Ausprobieren ohne Tokens: `bun run dev` startet den Live-Server gegen einen Mock, der alle
15 Sekunden abgefragt wird und laufend neue Kommentare erzeugt – gut, um Live-Updates und Ton zu
sehen. `bun run demo` macht dasselbe für den statischen Modus (`out-demo/dashboard.html`).

## Statischer Modus (Cron)

`bun run start` macht einen Lauf und schreibt `out/dashboard.html`; die Seite lädt sich alle
`REFRESH_SECONDS` selbst neu (ohne Ton – dafür braucht es den Live-Server).

**macOS / Linux (cron)**: `crontab -e`

```
*/5 * * * * /pfad/zu/dev-dashboard/run.sh
```

`run.sh` wechselt ins Projektverzeichnis (wegen `.env`) und loggt nach `out/run.log`.

**Windows**: Am einfachsten der Loop-Modus statt Aufgabenplanung (kein Konsolenfenster, das alle
5 Minuten aufblitzt): Verknüpfung auf `run-loop.cmd` in den Autostart-Ordner legen
(`Win+R` → `shell:startup`), Ausführen: *Minimiert*. Alternativ in der Aufgabenplanung `bun.exe` mit
Argument `run src/main.ts`, „Starten in“ = Projektordner, Trigger alle 5 Minuten.

`bun run loop` funktioniert überall und ist auch zum Entwickeln praktisch.

## Aufbau

```
src/
  server.ts     Live-Server: Polling-Schleife, WebSocket-Push, API
  main.ts       statischer Modus: ein Lauf → out/dashboard.html
  engine.ts     ein Abruf: laden → abrufen → diff → Regeln → speichern
  config.ts     .env → typisierte Config
  ado.ts        Azure DevOps: PRs, Reviewer-Votes, Kommentar-Threads
  jira.ts       Jira DC REST v2: JQL-Suche, Kommentare
  correlate.ts  Ticket-Keys aus PR-Text, PR ↔ Ticket-Verknüpfung
  diff.ts       Snapshot-Vergleich → Änderungslog
  rules.ts      Hinweise für „Zu tun“ – hier eigene Regeln ergänzen
  render.ts     HTML (inline CSS/JS, hell/dunkel), Client-Skript mit Live-Updates + Ton
  model.ts      gemeinsame Typen
mock/           Fake-APIs, Demo (statisch) und Live-Demo
```

Eine Regel ist nur eine Funktion `(snapshot, ctx) => Hint[]`. Neue Regel schreiben, ins Array
`rules` hängen, fertig.

## Hinweise

- Fällt eine Quelle aus (VPN weg, Token abgelaufen), zeigt die Seite einen Fehlerbalken und den
  letzten bekannten Stand. Der nächste erfolgreiche Lauf meldet dann nicht alles als neu.
- Der erste Lauf ist nur die Basis, Änderungen erscheinen ab dem zweiten.
- Ein ungültiger ADO-PAT liefert HTTP 203 mit Login-Seite statt 401; das wird als
  „PAT ungültig oder abgelaufen?“ gemeldet.
- `JIRA_POST_MERGE_STATUSES` an eure Board-Spalten anpassen, sonst kommt
  „weiterschieben?“ zu oft oder zu selten.
- On-Prem Azure DevOps Server: `ADO_ORG_URL` auf die Collection setzen und ggf.
  `ADO_API_VERSION` senken (z. B. `7.0`). Klappt `_apis/connectionData` nicht, `ADO_USER_ID` setzen.
- Jira Cloud statt DC: nur `jira.ts` ändern (Basic Auth mit E-Mail + API-Token,
  `/rest/api/3/search/jql` mit `nextPageToken`, Kommentare im ADF-Format).
