# Dev-Dashboard

Lokales Dashboard für Jira Data Center + Azure DevOps. Ein Lauf holt deine PRs und Sprint-Tickets,
vergleicht sie mit dem letzten Stand und schreibt `out/dashboard.html`. Die Seite lädt sich alle
5 Minuten selbst neu. Laufzeit-Abhängigkeiten: keine (nur Bun).

**Was du siehst**

- **Zu tun**: Review angefragt, Reviewer wartet/lehnt ab, offene Kommentar-Threads, Merge-Konflikte,
  unbeantwortetes Ticket-Feedback (z. B. vom Test), „PR gemerged, Ticket noch nicht weitergeschoben“,
  „bereit zum Mergen“.
- **Änderungen**: was *andere* seit dem letzten Lauf getan haben (Votes, Kommentare, Statuswechsel,
  neue Review-Anfragen). Bleibt 48 h im Log. „Alles gesehen“ merkt sich der Browser; die Anzahl
  ungelesener Einträge steht im Tab-Titel, praktisch als angepinnter Tab.
- **Meine PRs / Reviews / Tickets**, verknüpft über den Ticket-Key in PR-Titel oder Branchname.

## Einrichten

```sh
bun install          # nur für Typecheck nötig
cp .env.example .env # ausfüllen
bun run start        # ein Lauf → out/dashboard.html
```

**Tokens**

- Jira DC: Profil → *Personal Access Tokens* (ab Jira 8.14). Wird als `Bearer` gesendet.
- Azure DevOps: *User settings → Personal access tokens*, Scope **Code (Read)** reicht.

Erst nur eine Quelle? Einfach die URL der anderen leer lassen.

Zum Ausprobieren ohne Tokens: `bun run demo` startet einen Mock-Server, läuft zweimal und
schreibt `out-demo/dashboard.html` mit Beispieldaten.

## Automatisch alle 5 Minuten

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
  main.ts       Ablauf: laden → abrufen → diff → Regeln → rendern → speichern
  config.ts     .env → typisierte Config
  ado.ts        Azure DevOps: PRs, Reviewer-Votes, Kommentar-Threads
  jira.ts       Jira DC REST v2: JQL-Suche, Kommentare
  correlate.ts  Ticket-Keys aus PR-Text, PR ↔ Ticket-Verknüpfung
  diff.ts       Snapshot-Vergleich → Änderungslog
  rules.ts      Hinweise für „Zu tun“ – hier eigene Regeln ergänzen
  render.ts     HTML (inline CSS/JS, hell/dunkel)
  model.ts      gemeinsame Typen
mock/           Fake-APIs + Demo
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
