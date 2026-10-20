# Dev Dashboard

A small self-hosted dashboard for **Jira Data Center**, **Azure DevOps**, **GitHub.com** and
**GitHub Enterprise**. A Bun server polls your PRs, tickets, issues and CI runs, compares them with
the last known state and pushes every change straight to open tabs over a WebSocket – with a
notification sound. Runs locally or in Docker, UI in English or German. Runtime dependencies: none
(just Bun).

There's also a static mode: one run writes `out/dashboard.html`, e.g. from cron.

**What you see**

- **To do**: review requested, reviewer waiting/rejected, open comment threads, merge conflicts,
  failing checks, failed runs, unanswered feedback (on your tickets, or wherever you took part in
  the discussion), "PR merged but ticket not moved on", "ready to merge".
- **Changes**: what *other people* did since the last poll – votes, comments, status changes,
  merges, new review requests, finished CI runs. Your own actions don't show up (your votes,
  comments, merges, ticket moves). Kept for 48 h. "Mark all seen" is remembered by the browser,
  and the number of unseen entries shows up in the tab title – handy as a pinned tab. When a new
  change comes in, a short chime plays (toggle with 🔔; browsers only allow sound after you clicked
  the page once, until then the button says "Click to enable").
- **My PRs / Reviews for me / Runs / Involved & watched / Tickets**, PRs linked to Jira via the
  ticket key in the PR title or branch name.

## Sources

A source is on as soon as its token is in `.env`.

| | PRs | Issues | CI runs | "Involved" means |
|---|---|---|---|---|
| **Jira DC** | – | sprint list (`JIRA_JQL`) + `JIRA_INVOLVED_JQL` | – | you watch it – Jira makes you a watcher when you comment |
| **Azure DevOps** | yours, review requests, ones you commented on | – | builds you queued | commented: found by looking through the project's active PRs every `ADO_DISCOVER_MINUTES` (ADO can't search for that), then followed |
| **GitHub.com / Enterprise** | yours, review requests, reviewed or commented by you | involved or assigned | workflow runs you triggered (in repos you were active in lately) | GitHub's `involves:` search – author, assignee, mentioned, commented |

Something not covered? Paste its link into **+ Watch** – a PR, issue or run of any configured
source. Watched runs are dropped by themselves a day after they finished.

**Mute** (🔔 on hover, always visible on phones): the item stays in the lists, dimmed, but its
changes don't ring or count as new, and its hints disappear. Muted things are listed at the bottom
to unmute them. Watches and mutes are stored on the server (`prefs.json` next to the state), so
they apply to every browser.

## Setup

```sh
cp .env.example .env # fill in
```

**Tokens**

- Jira DC: Profile → *Personal Access Tokens* (Jira 8.14+). Sent as `Bearer`.
- Azure DevOps: *User settings → Personal access tokens*, scopes **Code (Read)** and **Build (Read)**
  (without the latter, PRs still work and the page shows a hint).
- GitHub: classic token with `repo`, or fine-grained with read access to Pull requests, Issues,
  Actions and Metadata. Same for Enterprise (`GHE_URL` + `GHE_TOKEN`).

### Docker (recommended)

```sh
docker compose pull && docker compose up -d   # prebuilt image from ghcr.io → http://localhost:3000
docker compose up -d --build                  # or build from source
docker compose logs -f
```

You don't need to clone the repo, two files are enough:

```sh
mkdir dev-dashboard && cd dev-dashboard
curl -fsSLO https://raw.githubusercontent.com/rinukkusu/dev-dashboard/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/rinukkusu/dev-dashboard/main/.env.example -o .env
# fill in .env, then:
docker compose pull && docker compose up -d
```

- The port is only bound to `127.0.0.1` – the page shows internal data and has no login. Port 3000
  taken? Change `PORT` in `.env`.
- State (the change log) lives in the `data` volume and survives restarts.
- Jira/ADO behind a company CA? Mount the certificate and set `NODE_EXTRA_CA_CERTS` (see `compose.yaml`).
- VPN-only hosts: Docker Desktop has to get through the VPN (usually works out of the box).

Images (amd64 + arm64) are built by GitHub Actions: `main` → `ghcr.io/rinukkusu/dev-dashboard:latest`,
tag `v1.2.3` → `:1.2.3`, `:1.2`, `:1` plus a GitHub release.

### Without Docker

```sh
bun run serve        # live server → http://localhost:3000
bun install          # only needed for the typecheck
```

Endpoints: `/` dashboard, `/ws` WebSocket, `/api/state` current state as JSON,
`POST /api/refresh` poll now (the "Refresh now" button), `GET/POST/DELETE /api/watches`,
`POST /api/mute`, `/healthz`. Changing requests must be JSON, so other websites can't change your
settings through your browser.

### Try it without tokens

`bun run dev` starts the live server against a mock of all three systems (GitHub as Enterprise),
polled every 15 seconds, which keeps producing new comments – good for seeing live updates and the
sound. To try **+ Watch**, paste the run link it prints at startup: a deploy that finishes two polls
later. `bun run demo` does the same for the static mode (`out-demo/dashboard.html`). The ADO and
Jira mock data is in German.

`bun test` runs the unit tests (change detection, watch links, muting).

## Language

`DASHBOARD_LANG=en|de` sets the default (English if unset). In the live server every browser can
switch in the header; the choice is stored in a cookie. The change log stores raw facts instead of
finished sentences, so switching also translates entries that are already there. Texts live in
`src/i18n.ts` – adding a language means adding one dictionary there.

## Static mode (cron)

`bun run start` does one run and writes `out/dashboard.html`; the page reloads itself every
`REFRESH_SECONDS` (no sound – that needs the live server).

**macOS / Linux (cron)**: `crontab -e`

```
*/5 * * * * /path/to/dev-dashboard/run.sh
```

`run.sh` changes into the project folder (for `.env`) and logs to `out/run.log`.

**Windows**: Easiest is the loop mode instead of Task Scheduler (no console window flashing every
5 minutes): put a shortcut to `run-loop.cmd` into the Startup folder (`Win+R` → `shell:startup`),
Run: *Minimized*. Alternatively Task Scheduler with `bun.exe`, argument `run src/main.ts`,
"Start in" = project folder, trigger every 5 minutes.

`bun run loop` works everywhere and is handy for development too.

## Structure

```
src/
  server.ts     live server: poll loop, WebSocket push, API
  main.ts       static mode: one run → out/dashboard.html
  engine.ts     one poll: run all sources → diff → save
  config.ts     .env → typed config (a source is on when its token is set)
  sources/
    types.ts    the Source interface
    ado.ts      Azure DevOps: PRs, votes, threads, builds, "PRs I commented on"
    github.ts   GitHub.com + Enterprise: GraphQL for PRs/issues, REST for workflow runs
    jira.ts     Jira DC REST v2: JQL searches, comments, who changed what
    index.ts    which sources are on
  prefs.ts      watches + mutes (prefs.json)
  correlate.ts  ticket keys from PR text, PR ↔ ticket links
  diff.ts       snapshot comparison → change log, filters out your own actions
  rules.ts      hints for "To do" – add your own rules here
  render.ts     HTML (inline CSS/JS, light/dark), browser script with live updates, sound, watch dialog
  i18n.ts       UI texts (en, de)
  model.ts      shared types
mock/           fake APIs, static demo and live demo
test/           unit tests
```

A rule is just a function `(snapshot, ctx) => Hint[]`. Write one, add it to the `rules` array, done.
Use `ctx.t` for its text so it works in both languages.

A new source implements `Source` from `src/sources/types.ts`: `fetch()` returns PRs, issues and runs
in the shared model (ids prefixed with the source id), `parseWatchUrl()` recognizes its links. Then
create it in `sources/index.ts` when its token is set. Diffing, rules, muting and the UI work for it
without changes.

## Notes

- If a source fails (VPN gone, token expired), the page shows an error bar and the last known
  state. The next successful poll then doesn't report everything as new.
- The first poll is only the baseline, changes show up from the second one on.
- An invalid ADO PAT returns HTTP 203 with a login page instead of 401; that gets reported as
  "PAT invalid or expired?".
- Adjust `JIRA_POST_MERGE_STATUSES` to your board columns, otherwise "move it on?" shows up too
  often or too rarely.
- On-prem Azure DevOps Server: set `ADO_ORG_URL` to the collection and lower `ADO_API_VERSION` if
  needed (e.g. `7.0`). If `_apis/connectionData` doesn't work, set `ADO_USER_ID`.
- Jira Cloud instead of DC: only `sources/jira.ts` needs changes (Basic auth with email + API token,
  `/rest/api/3/search/jql` with `nextPageToken`, comments in ADF format).
