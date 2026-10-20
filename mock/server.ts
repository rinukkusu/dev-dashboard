// Fake Jira DC + Azure DevOps + GitHub (Enterprise-style, under /gh) for trying the dashboard
// without real credentials. Each source counts its own polls ("ticks"): the first poll is the
// baseline, the second one sees votes, comments, status changes and finished runs. After that
// ADO keeps adding comments so the live server always has something to show.
//
//   bun run mock          → http://localhost:4010
//   JIRA_BASE_URL=http://localhost:4010/jira  ADO_ORG_URL=http://localhost:4010/ado  ADO_PROJECT=Shop
//   GHE_URL=http://localhost:4010/gh  (any token)

const start = Date.now();
const ticks = { ado: 0, jira: 0, gh: 0 };
let origin = "";

const liveComments: { hoursAgo: number }[] = [];
const LIVE_TEXTS = [
  "Magic Number bitte in eine Konstante.",
  "Der Log-Level hier ist zu hoch, oder?",
  "Kann man das nicht mit dem bestehenden Helper lösen?",
];

// Timestamps in the sources' native formats (on purpose, to exercise parsing).
const pad = (n: number) => String(n).padStart(2, "0");
const jiraTime = (hoursAgo: number) => {
  const d = new Date(start - hoursAgo * 3_600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00.000+0000`;
};
const adoTime = (hoursAgo: number) => new Date(start - hoursAgo * 3_600_000).toISOString().replace("Z", "4567Z");
const ghTime = (hoursAgo: number) => new Date(start - hoursAgo * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
/** "now" as hours-ago, for things that happen during the session */
const nowAgo = () => (start - Date.now()) / 3_600_000;

// =============================================================================
// Azure DevOps
// =============================================================================

const ME = { id: "me", displayName: "Max Müller" };
const ANNA = { id: "anna", displayName: "Anna Berger" };
const BERND = { id: "bernd", displayName: "Bernd Kogler" };
const CLARA = { id: "clara", displayName: "Clara Wolf" };

const repo = (id: string, name: string) => ({ id, name, webUrl: `https://dev.azure.com/demo/Shop/_git/${name}`, project: { name: "Shop" } });
const API = repo("r1", "shop-api");
const WEB = repo("r2", "shop-web");

const reviewer = (u: { id: string; displayName: string }, vote: number, isRequired = false) => ({ ...u, vote, isRequired });

const comment = (id: number, author: typeof ME, content: string, hoursAgo: number) => ({
  id, author, content, publishedDate: adoTime(hoursAgo), commentType: "text",
});

function pullRequests() {
  const t2 = ticks.ado >= 2;
  return [
    {
      pullRequestId: 412, repository: API, createdBy: ME, status: "active",
      title: "ABC-101 Checkout: Gutschein-Validierung", sourceRefName: "refs/heads/feature/abc-101-gutschein",
      targetRefName: "refs/heads/main", creationDate: adoTime(50), mergeStatus: "succeeded",
      reviewers: [reviewer(ANNA, t2 ? 10 : 0, true), reviewer(BERND, 5)],
    },
    {
      pullRequestId: 415, repository: API, createdBy: ME, status: "active",
      title: "Rabatt-API: Rundung auf Cent", sourceRefName: "refs/heads/bugfix/ABC-104-rundung",
      targetRefName: "refs/heads/main", creationDate: adoTime(26), mergeStatus: "succeeded",
      reviewers: [reviewer(ANNA, 0, true), reviewer(CLARA, t2 ? -5 : 0)],
    },
    {
      pullRequestId: 418, repository: WEB, createdBy: ME, status: "active",
      title: "ABC-107 Lagerbestand-Sync: Retry-Logik", sourceRefName: "refs/heads/feature/ABC-107-retry",
      targetRefName: "refs/heads/main", creationDate: adoTime(6), mergeStatus: "conflicts",
      reviewers: [reviewer(BERND, 0)],
    },
    {
      // merged by Anna (not me), so that's news
      pullRequestId: 409, repository: WEB, createdBy: ME, status: t2 ? "completed" : "active",
      closedDate: t2 ? adoTime(0.05) : undefined, closedBy: t2 ? ANNA : undefined,
      title: "ABC-095 Versandkosten-Staffel", sourceRefName: "refs/heads/feature/ABC-095-versand",
      targetRefName: "refs/heads/main", creationDate: adoTime(72), mergeStatus: "succeeded",
      reviewers: [reviewer(ANNA, 10, true), reviewer(CLARA, 10)],
    },
    {
      pullRequestId: 405, repository: API, createdBy: BERND, status: "active",
      title: "ABC-099 Logging vereinheitlichen", sourceRefName: "refs/heads/feature/ABC-099-logging",
      targetRefName: "refs/heads/main", creationDate: adoTime(30), mergeStatus: "succeeded",
      reviewers: [reviewer(ME, 10), reviewer(ANNA, 0)],
    },
    {
      // not my PR, not my review – but I left a comment, so the dashboard finds it by itself
      pullRequestId: 430, repository: WEB, createdBy: ANNA, status: "active",
      title: "Caching-Layer für Produktbilder", sourceRefName: "refs/heads/feature/image-cache",
      targetRefName: "refs/heads/main", creationDate: adoTime(20), mergeStatus: "succeeded",
      reviewers: [reviewer(BERND, 0)],
    },
    ...(t2
      ? [{
          pullRequestId: 420, repository: WEB, createdBy: CLARA, status: "active",
          title: "ABC-110 Newsletter Double-Opt-in", sourceRefName: "refs/heads/feature/ABC-110-optin",
          targetRefName: "refs/heads/main", creationDate: adoTime(0.1), mergeStatus: "succeeded",
          reviewers: [reviewer(ME, 0, true), reviewer(BERND, 0)],
        }]
      : []),
  ];
}

function threads(prId: number) {
  const t2 = ticks.ado >= 2;
  const system = { id: 1, status: "unknown", comments: [{ id: 1, author: ME, content: "Updated", publishedDate: adoTime(1), commentType: "system" }] };
  switch (prId) {
    case 412:
      return [system, {
        id: 7, status: t2 ? "fixed" : "active",
        comments: [comment(1, BERND, "Sollte der Gutschein-Code nicht case-insensitive sein?", 20), comment(2, ME, "Guter Punkt, ist umgebaut.", 3)],
      }];
    case 415:
      return [system, {
        id: 3, status: "active",
        comments: [comment(1, CLARA, "Warum MidpointRounding.ToEven? Fachlich ist kaufmännisch gefordert.", 10)],
      }, ...(t2 ? [{
        id: 4, status: "active",
        comments: [comment(1, CLARA, "Bitte noch Unit-Tests für negative Beträge (Gutschriften) ergänzen.", 0.05)],
      }] : []), ...liveComments.map((c, i) => ({
        id: 100 + i, status: "active",
        comments: [comment(1, BERND, `Noch eine Kleinigkeit (#${i + 1}): ${LIVE_TEXTS[i % LIVE_TEXTS.length]}`, c.hoursAgo)],
      }))];
    case 430:
      return [system, {
        id: 2, status: "active",
        comments: [
          comment(1, ME, "Wie lange bleiben die Bilder im Cache? Bei Preisänderungen wäre das blöd.", 8),
          ...(t2 ? [comment(2, ANNA, "Gute Frage – 10 Minuten, Preise sind nicht im Bild. Passt das?", 0.05)] : []),
        ],
      }];
    default:
      return [system];
  }
}

function builds() {
  const t2 = ticks.ado >= 2;
  const build = (id: number, def: string, branch: string, status: string, result: string | undefined, queuedHoursAgo: number, finishedHoursAgo?: number) => ({
    id, buildNumber: `20261019.${id - 890}`, status, result, definition: { name: def },
    sourceBranch: `refs/heads/${branch}`, queueTime: adoTime(queuedHoursAgo), startTime: adoTime(queuedHoursAgo - 0.01),
    finishTime: finishedHoursAgo !== undefined ? adoTime(finishedHoursAgo) : undefined,
    repository: { name: "shop-api" }, requestedFor: ME, triggerInfo: { "ci.message": "Rundung auf Cent" },
    _links: { web: { href: `https://dev.azure.com/demo/Shop/_build/results?buildId=${id}` } },
  });
  return [
    build(898, "shop-web CI", "feature/ABC-107-retry", "completed", "failed", 3, 2.9),
    t2
      ? build(900, "shop-api CI", "bugfix/ABC-104-rundung", "completed", "succeeded", 0.3, 0.02)
      : build(900, "shop-api CI", "bugfix/ABC-104-rundung", "inProgress", undefined, 0.3),
  ];
}

// =============================================================================
// Jira
// =============================================================================

const JME = { name: "mmueller", key: "mmueller", displayName: "Max Müller" };
const LISA = { name: "lhuber", key: "lhuber", displayName: "Lisa Huber (QA)" };
const JANNA = { name: "aberger", key: "aberger", displayName: "Anna Berger" };
const JBERND = { name: "bkogler", key: "bkogler", displayName: "Bernd Kogler" };
const JCLARA = { name: "cwolf", key: "cwolf", displayName: "Clara Wolf" };

const jc = (id: string, author: typeof JME, body: string, hoursAgo: number) => ({ id, author, body, created: jiraTime(hoursAgo) });
const issue = (key: string, summary: string, type: string, status: string, cat: string, assignee: typeof JME, comments: ReturnType<typeof jc>[], updatedHoursAgo: number) => ({
  key,
  fields: {
    summary, updated: jiraTime(updatedHoursAgo), issuetype: { name: type },
    status: { name: status, statusCategory: { key: cat } }, assignee, comment: { comments },
  },
});

function sprintIssues() {
  const t2 = ticks.jira >= 2;
  return [
    issue("ABC-101", "Gutschein-Validierung im Checkout", "Story", "In Review", "indeterminate", JME, [], 20),
    // I move this one myself on the second poll → no notification
    issue("ABC-104", "Rabatte werden falsch gerundet", "Bug", t2 ? "In Review" : "In Progress", "indeterminate", JME,
      [jc("5001", JANNA, "Kunde meldet 0,01 € Abweichung bei *Mengenrabatt* ab 3 Stück.", 30)], t2 ? 0.05 : 26),
    issue("ABC-107", "Lagerbestand-Sync: Retry bei Timeouts", "Story", "In Progress", "indeterminate", JME, [], 6),
    issue("ABC-095", "Versandkosten-Staffel nach Gewicht", "Story", "In Review", "indeterminate", JME, [], 40),
    issue("ABC-098", "PDF-Rechnung exportieren", "Story", t2 ? "In Progress" : "In Test", "indeterminate", JME,
      [jc("5010", JME, "Fertig, bitte testen.", 28),
       ...(t2 ? [jc("5011", LISA, "Export bricht bei Umlauten im Firmennamen ab ({{Müller & Söhne}}). [~mmueller] kannst du dir das ansehen?", 0.05)] : [])],
      t2 ? 0.05 : 28),
    ...(t2 ? [issue("ABC-112", "Suchfilter auf Mobile einklappbar", "Story", "To Do", "new", JME, [], 0.1)] : []),
  ];
}

/** Watcher JQL: tickets of others I commented on or follow. */
function involvedIssues() {
  const t2 = ticks.jira >= 2;
  return [
    issue("ABC-120", "Zahlungsanbieter-Timeout analysieren", "Bug", "In Progress", "indeterminate", JBERND,
      [jc("6001", JME, "Passiert das nur bei Kreditkarte oder auch bei SEPA?", 10),
       ...(t2 ? [jc("6002", JBERND, "Nur Kreditkarte, und nur über 500 €. Kann das mit dem Limit-Check zusammenhängen?", 0.05)] : [])],
      t2 ? 0.05 : 10),
    issue("ABC-121", "Retourenlabel als PDF", "Story", t2 ? "Done" : "In Test", t2 ? "done" : "indeterminate", JCLARA, [], t2 ? 0.05 : 30),
  ];
}

const otherIssues = [
  issue("ABC-099", "Logging vereinheitlichen", "Task", "In Review", "indeterminate", JBERND, [], 30),
  issue("ABC-110", "Newsletter Double-Opt-in", "Story", "In Review", "indeterminate", JCLARA, [], 1),
];

/** Who made the latest status/assignment change – that's how the dashboard filters out my own. */
const CHANGED_BY: Record<string, typeof JME> = { "ABC-104": JME, "ABC-098": LISA, "ABC-121": LISA, "ABC-112": JCLARA };

function changelog(key: string) {
  const author = CHANGED_BY[key] ?? JBERND;
  return {
    key,
    changelog: {
      histories: [
        { author: JBERND, created: jiraTime(48), items: [{ field: "status" }] },
        { author, created: jiraTime(0.05), items: [{ field: "status" }, { field: "assignee" }, { field: "Sprint" }] },
      ],
    },
  };
}

// =============================================================================
// GitHub (Enterprise-style URLs: /gh/api/graphql, /gh/api/v3)
// =============================================================================

const GH_ME = "maxm";
const user = (login: string, name: string) => ({ login, name });
const GME = user(GH_ME, "Max Müller");
const OANNA = user("octo-anna", "Anna Octo");
const OBERND = user("octo-bernd", "Bernd Octo");
const OCLARA = user("octo-clara", "Clara Octo");
const TOOLS = { name: "tools", nameWithOwner: "acme/tools" };
const DOCS = { name: "docs", nameWithOwner: "acme/docs" };
const ghWeb = (path: string) => `${origin}/gh/${path}`;
const ghc = (id: string, author: ReturnType<typeof user>, body: string, hoursAgo: number) => ({ id, author, body, createdAt: ghTime(hoursAgo) });
const nodes = <T>(list: T[]) => ({ nodes: list });

type GhPrInput = {
  repo: typeof TOOLS; number: number; title: string; author: ReturnType<typeof user>; branch: string; hoursAgo: number;
  requested?: ReturnType<typeof user>[]; reviews?: { author: ReturnType<typeof user>; state: string }[];
  comments?: ReturnType<typeof ghc>[]; threads?: { isResolved: boolean; comments: ReturnType<typeof ghc>[] }[];
  checks?: string; state?: string;
};

const ghPr = (p: GhPrInput) => ({
  __typename: "PullRequest", number: p.number, title: p.title, url: ghWeb(`${p.repo.nameWithOwner}/pull/${p.number}`),
  body: "", isDraft: false, state: p.state ?? "OPEN", createdAt: ghTime(p.hoursAgo), closedAt: null, mergeable: "MERGEABLE",
  headRefName: p.branch, baseRefName: "main", author: p.author, mergedBy: null, repository: p.repo,
  reviewRequests: nodes((p.requested ?? []).map((u) => ({ requestedReviewer: { __typename: "User", ...u } }))),
  latestReviews: nodes(p.reviews ?? []),
  reviews: nodes([]),
  comments: nodes(p.comments ?? []),
  reviewThreads: nodes((p.threads ?? []).map((t) => ({ isResolved: t.isResolved, comments: nodes(t.comments) }))),
  commits: nodes([{ commit: { statusCheckRollup: p.checks ? { state: p.checks } : null } }]),
  timelineItems: nodes([]),
});

const ghIssue = (repo: typeof TOOLS, number: number, title: string, author: ReturnType<typeof user>, assignees: ReturnType<typeof user>[], comments: ReturnType<typeof ghc>[], updatedHoursAgo: number) => ({
  __typename: "Issue", number, title, url: ghWeb(`${repo.nameWithOwner}/issues/${number}`), state: "OPEN",
  updatedAt: ghTime(updatedHoursAgo), author, assignees: nodes(assignees), repository: repo, comments: nodes(comments), timelineItems: nodes([]),
});

function ghPrs() {
  const t2 = ticks.gh >= 2;
  return {
    mine: [
      ghPr({
        repo: TOOLS, number: 7, title: "Uploader: retry with backoff", author: GME, branch: "feature/retry", hoursAgo: 5,
        requested: t2 ? [] : [OANNA], reviews: t2 ? [{ author: OANNA, state: "APPROVED" }] : [],
        threads: [{ isResolved: true, comments: [ghc("t1", OANNA, "Maybe cap the backoff at 30s?", 4)] }],
        checks: t2 ? "SUCCESS" : "PENDING",
      }),
    ],
    toReview: [
      ghPr({ repo: DOCS, number: 9, title: "Add dark mode to the docs site", author: OBERND, branch: "dark-mode", hoursAgo: 20, requested: [GME], checks: "SUCCESS" }),
      ...(t2 ? [ghPr({ repo: TOOLS, number: 11, title: "Bump bun to 1.4", author: OCLARA, branch: "bump-bun", hoursAgo: 0.1, requested: [GME], checks: "PENDING" })] : []),
    ],
    involved: [
      ghPr({
        repo: TOOLS, number: 5, title: "Refactor config loader", author: OANNA, branch: "config-loader", hoursAgo: 30, checks: "SUCCESS",
        comments: [
          ghc("c51", GME, "Could we keep the old env names as aliases for a release?", 6),
          ...(t2 ? [ghc("c52", OANNA, "Sure, added aliases + a deprecation warning.", 0.05)] : []),
        ],
      }),
    ],
  };
}

function ghIssues() {
  const t2 = ticks.gh >= 2;
  return {
    involved: [
      ghIssue(TOOLS, 12, "Flaky upload test on Windows", OBERND, [], [
        ghc("c121", GME, "Seeing this too, mostly on the first run after a cache clear.", 9),
        ...(t2 ? [ghc("c122", OBERND, "Could the new retry in #7 fix this? Can you check on your machine?", 0.05)] : []),
      ], t2 ? 0.05 : 9),
    ],
    assigned: [ghIssue(DOCS, 3, "Document the retry settings", OANNA, [GME], [], 26)],
  };
}

const ghRun = (id: number, n: number, name: string, title: string, branch: string, status: string, conclusion: string | null, actor: string, createdHoursAgo: number, updatedHoursAgo: number) => ({
  id, run_number: n, name, display_title: title, head_branch: branch, status, conclusion,
  html_url: ghWeb(`acme/tools/actions/runs/${id}`), created_at: ghTime(createdHoursAgo), updated_at: ghTime(updatedHoursAgo),
  actor: { login: actor }, triggering_actor: { login: actor }, repository: { full_name: "acme/tools", name: "tools" },
});

function ghRuns() {
  const t2 = ticks.gh >= 2;
  return [
    ghRun(500, 41, "CI", "Uploader: retry with backoff", "feature/retry", "completed", "success", GH_ME, 2, 1.9),
    t2
      ? ghRun(501, 12, "Release", "v1.4.0", "main", "completed", "failure", GH_ME, 0.3, 0.02)
      : ghRun(501, 12, "Release", "v1.4.0", "main", "in_progress", null, GH_ME, 0.3, 0.2),
  ];
}

/** Someone else's deploy – only shows up if you watch its link. Finishes two polls after you do. */
let deployWatchedAt: number | undefined;
let deployFinishedAgo: number | undefined;
function watchableRun() {
  deployWatchedAt ??= ticks.gh;
  if (ticks.gh >= deployWatchedAt + 2) deployFinishedAgo ??= nowAgo();
  return deployFinishedAgo !== undefined
    ? ghRun(600, 88, "Deploy staging", "Deploy acme/tools@main", "main", "completed", "success", "octo-anna", 1, deployFinishedAgo)
    : ghRun(600, 88, "Deploy staging", "Deploy acme/tools@main", "main", "in_progress", null, "octo-anna", 1, 0.5);
}

function graphql(query: string) {
  if (/^\s*query\s*\{\s*viewer\b/.test(query)) return { data: { viewer: { login: GH_ME } } };
  ticks.gh++;
  const prs = ghPrs();
  const issues = ghIssues();
  const allPrs = [...prs.mine, ...prs.toReview, ...prs.involved];
  const data: Record<string, unknown> = {
    authored: nodes(prs.mine),
    requested: nodes(prs.toReview),
    reviewed: nodes([]),
    involvedPrs: nodes([...prs.mine, ...prs.involved]),
    involvedIssues: nodes(issues.involved),
    assigned: nodes(issues.assigned),
  };
  const errors: { message: string }[] = [];
  for (const m of query.matchAll(/(w\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\) \{\s*issueOrPullRequest\(number: (\d+)\)/g)) {
    const [, alias, owner, name, number] = m as unknown as [string, string, string, string, string];
    const nwo = `${owner}/${name}`.toLowerCase();
    const node = [...allPrs, ...issues.involved, ...issues.assigned].find(
      (n) => n.repository.nameWithOwner.toLowerCase() === nwo && n.number === Number(number),
    );
    data[alias] = { issueOrPullRequest: node ?? null };
    if (!node) errors.push({ message: `Could not resolve to an issue or pull request with the number of ${number}.` });
  }
  return errors.length ? { data, errors } : { data };
}

// =============================================================================

const json = (data: unknown, status = 200) => Response.json(data, { status });

export function startMock(port = 4010) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      const q = url.searchParams;

      // --- Azure DevOps ---
      if (p === "/ado/_apis/connectionData") {
        ticks.ado++;
        // After the scripted scenario, keep the live server busy: a new comment every second poll.
        if (ticks.ado >= 3 && ticks.ado % 2 === 1) liveComments.push({ hoursAgo: nowAgo() });
        return json({ authenticatedUser: { id: ME.id } });
      }
      if (p === "/ado/Shop/_apis/git/pullrequests") {
        const status = q.get("searchCriteria.status");
        const creator = q.get("searchCriteria.creatorId");
        const reviewerId = q.get("searchCriteria.reviewerId");
        const value = pullRequests().filter(
          (pr) =>
            pr.status === status &&
            (!creator || pr.createdBy.id === creator) &&
            (!reviewerId || pr.reviewers.some((r) => r.id === reviewerId)),
        );
        return json({ value, count: value.length });
      }
      const prById = p.match(/^\/ado\/_apis\/git\/pullrequests\/(\d+)$/);
      if (prById) {
        const pr = pullRequests().find((x) => x.pullRequestId === Number(prById[1]));
        return pr ? json(pr) : json({ message: "not found" }, 404);
      }
      const t = p.match(/^\/ado\/Shop\/_apis\/git\/repositories\/[^/]+\/pullRequests\/(\d+)\/threads$/);
      if (t) return json({ value: threads(Number(t[1])) });
      if (p === "/ado/Shop/_apis/build/builds") return json({ value: builds() });
      const buildById = p.match(/^\/ado\/Shop\/_apis\/build\/builds\/(\d+)$/);
      if (buildById) {
        const b = builds().find((x) => x.id === Number(buildById[1]));
        return b ? json(b) : json({ message: "not found" }, 404);
      }

      // --- Jira DC ---
      if (p === "/jira/rest/api/2/myself") {
        ticks.jira++;
        return json(JME);
      }
      if (p === "/jira/rest/api/2/search") {
        const jql = q.get("jql") ?? "";
        const keys = jql.match(/^key in \((.*)\)$/)?.[1]?.split(",").map((k) => k.trim());
        const all = keys
          ? [...otherIssues, ...involvedIssues(), ...sprintIssues()].filter((i) => keys.includes(i.key))
          : jql.includes("watcher") ? involvedIssues() : sprintIssues();
        const startAt = Number(q.get("startAt") ?? 0);
        const max = Number(q.get("maxResults") ?? 50);
        return json({ startAt, maxResults: max, total: all.length, issues: all.slice(startAt, startAt + max) });
      }
      const jiraIssue = p.match(/^\/jira\/rest\/api\/2\/issue\/([A-Z]+-\d+)$/);
      if (jiraIssue) return json(changelog(jiraIssue[1]!));

      // --- GitHub ---
      if (p === "/gh/api/graphql" && req.method === "POST") {
        const body = (await req.json()) as { query: string };
        return json(graphql(body.query));
      }
      if (p === `/gh/api/v3/users/${GH_ME}/events`) {
        return json([{ type: "PushEvent", repo: { name: "acme/tools" }, created_at: ghTime(0.5) }]);
      }
      if (p === "/gh/api/v3/repos/acme/tools/actions/runs") return json({ total_count: 2, workflow_runs: ghRuns() });
      const runById = p.match(/^\/gh\/api\/v3\/repos\/acme\/tools\/actions\/runs\/(\d+)$/);
      if (runById) {
        const run = [...ghRuns(), watchableRun()].find((r) => r.id === Number(runById[1]));
        return run ? json(run) : json({ message: "Not Found" }, 404);
      }
      if (p.startsWith("/gh/api/v3/repos/")) return json({ message: "Not Found" }, 404);

      return new Response(`Mock: unknown path ${p}`, { status: 404 });
    },
  });
  origin = server.url.origin;
  return server;
}

/** Env for pointing the dashboard at a running mock. */
export const mockEnv = (base: string) => ({
  JIRA_BASE_URL: `${base}/jira`,
  JIRA_PAT: "demo",
  JIRA_PROJECT_KEYS: "ABC",
  ADO_ORG_URL: `${base}/ado`,
  ADO_PROJECT: "Shop",
  ADO_PAT: "demo",
  GHE_URL: `${base}/gh`,
  GHE_TOKEN: "demo",
  GHE_LABEL: "GitHub (mock)",
});

if (import.meta.main) {
  const server = startMock();
  console.log(`Mock running at ${server.url}`);
}
