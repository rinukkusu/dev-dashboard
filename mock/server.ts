// Fake Jira DC + Azure DevOps for trying the dashboard without real credentials.
// Every dashboard run calls ADO connectionData once; that advances the scenario by one tick,
// so the second run sees votes, comments and status changes.
//
//   bun run mock          → http://localhost:4010
//   JIRA_BASE_URL=http://localhost:4010/jira  ADO_ORG_URL=http://localhost:4010/ado  ADO_PROJECT=Shop

const start = Date.now();
let tick = 0;

// Timestamps in the sources' native formats (on purpose, to exercise parsing).
const pad = (n: number) => String(n).padStart(2, "0");
const jiraTime = (hoursAgo: number) => {
  const d = new Date(start - hoursAgo * 3_600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00.000+0000`;
};
const adoTime = (hoursAgo: number) => new Date(start - hoursAgo * 3_600_000).toISOString().replace("Z", "4567Z");

const ME = { id: "me", displayName: "Max Müller" };
const ANNA = { id: "anna", displayName: "Anna Berger" };
const BERND = { id: "bernd", displayName: "Bernd Kogler" };
const CLARA = { id: "clara", displayName: "Clara Wolf" };
const LISA = { name: "lhuber", key: "lhuber", displayName: "Lisa Huber (QA)" };
const JME = { name: "mmueller", key: "mmueller", displayName: "Max Müller" };

const repo = (id: string, name: string) => ({ id, name, webUrl: `https://dev.azure.com/demo/Shop/_git/${name}` });
const API = repo("r1", "shop-api");
const WEB = repo("r2", "shop-web");

const reviewer = (u: { id: string; displayName: string }, vote: number, isRequired = false) => ({ ...u, vote, isRequired });

const comment = (id: number, author: typeof ME, content: string, hoursAgo: number) => ({
  id, author, content, publishedDate: adoTime(hoursAgo), commentType: "text",
});

function pullRequests() {
  const t2 = tick >= 2;
  const prs = [
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
      pullRequestId: 409, repository: WEB, createdBy: ME, status: t2 ? "completed" : "active",
      closedDate: t2 ? adoTime(0.05) : undefined,
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
    ...(t2
      ? [{
          pullRequestId: 420, repository: WEB, createdBy: CLARA, status: "active",
          title: "ABC-110 Newsletter Double-Opt-in", sourceRefName: "refs/heads/feature/ABC-110-optin",
          targetRefName: "refs/heads/main", creationDate: adoTime(0.1), mergeStatus: "succeeded",
          reviewers: [reviewer(ME, 0, true), reviewer(BERND, 0)],
        }]
      : []),
  ];
  return prs;
}

function threads(prId: number) {
  const t2 = tick >= 2;
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
      }] : [])];
    default:
      return [system];
  }
}

const jc = (id: string, author: typeof JME, body: string, hoursAgo: number) => ({ id, author, body, created: jiraTime(hoursAgo) });
const issue = (key: string, summary: string, type: string, status: string, cat: string, assignee: typeof JME, comments: ReturnType<typeof jc>[], updatedHoursAgo: number) => ({
  key,
  fields: {
    summary, updated: jiraTime(updatedHoursAgo), issuetype: { name: type },
    status: { name: status, statusCategory: { key: cat } }, assignee, comment: { comments },
  },
});

function sprintIssues() {
  const t2 = tick >= 2;
  return [
    issue("ABC-101", "Gutschein-Validierung im Checkout", "Story", "In Review", "indeterminate", JME, [], 20),
    issue("ABC-104", "Rabatte werden falsch gerundet", "Bug", "In Progress", "indeterminate", JME,
      [jc("5001", { name: "aberger", key: "aberger", displayName: "Anna Berger" }, "Kunde meldet 0,01 € Abweichung bei *Mengenrabatt* ab 3 Stück.", 30)], 26),
    issue("ABC-107", "Lagerbestand-Sync: Retry bei Timeouts", "Story", "In Progress", "indeterminate", JME, [], 6),
    issue("ABC-095", "Versandkosten-Staffel nach Gewicht", "Story", "In Review", "indeterminate", JME, [], 40),
    issue("ABC-098", "PDF-Rechnung exportieren", "Story", t2 ? "In Progress" : "In Test", "indeterminate", JME,
      [jc("5010", JME, "Fertig, bitte testen.", 28),
       ...(t2 ? [jc("5011", LISA, "Export bricht bei Umlauten im Firmennamen ab ({{Müller & Söhne}}). [~mmueller] kannst du dir das ansehen?", 0.05)] : [])],
      t2 ? 0.05 : 28),
    ...(t2 ? [issue("ABC-112", "Suchfilter auf Mobile einklappbar", "Story", "To Do", "new", JME, [], 0.1)] : []),
  ];
}

const otherIssues = [
  issue("ABC-099", "Logging vereinheitlichen", "Task", "In Review", "indeterminate", { name: "bkogler", key: "bkogler", displayName: "Bernd Kogler" }, [], 30),
  issue("ABC-110", "Newsletter Double-Opt-in", "Story", "In Review", "indeterminate", { name: "cwolf", key: "cwolf", displayName: "Clara Wolf" }, [], 1),
];

const json = (data: unknown) => Response.json(data);

export function startMock(port = 4010) {
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      const q = url.searchParams;

      // --- Azure DevOps ---
      if (p === "/ado/_apis/connectionData") {
        tick++;
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
      const t = p.match(/^\/ado\/Shop\/_apis\/git\/repositories\/[^/]+\/pullRequests\/(\d+)\/threads$/);
      if (t) return json({ value: threads(Number(t[1])) });

      // --- Jira DC ---
      if (p === "/jira/rest/api/2/myself") return json(JME);
      if (p === "/jira/rest/api/2/search") {
        const jql = q.get("jql") ?? "";
        const keys = jql.match(/^key in \((.*)\)$/)?.[1]?.split(",").map((k) => k.trim());
        const all = keys ? otherIssues.filter((i) => keys.includes(i.key)) : sprintIssues();
        const startAt = Number(q.get("startAt") ?? 0);
        const max = Number(q.get("maxResults") ?? 50);
        return json({ startAt, maxResults: max, total: all.length, issues: all.slice(startAt, startAt + max) });
      }

      return new Response(`Mock: unbekannter Pfad ${p}`, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = startMock();
  console.log(`Mock läuft auf ${server.url}`);
}
