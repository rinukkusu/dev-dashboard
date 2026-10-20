import type { AgentStatus, HintLevel, HintReason, RunConclusion, RunStatus, Vote } from "./model.ts";

// UI texts. Logs and error messages stay English; only what the dashboard shows is translated.

export const LANGS = ["en", "de"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (s: unknown): s is Lang => LANGS.includes(s as Lang);

export type Dict = {
  /** for Intl date formatting */
  locale: string;
  title: string;
  asOf: string;
  refresh: string;
  seenAll: string;
  markSeen: string;
  soundTitle: string;
  switchLang: string;
  firstPoll: string;
  staleSuffix: string;
  required: string;
  updated: string;
  mergedSuffix: string;
  by: (author: string) => string;
  tabs: Record<"home" | "prs" | "issues" | "runs" | "spaces", string>;
  sections: Record<"todo" | "changes" | "myPrs" | "reviews" | "involved" | "tickets" | "runs" | "merged" | "muted", string>;
  empty: Record<"todo" | "changes" | "myPrs" | "reviews" | "involved" | "tickets" | "runs", string>;
  levels: Record<HintLevel, string>;
  /** tooltip of a to-do's icon */
  reasons: Record<HintReason, string>;
  badges: Record<"draft" | "conflicts" | "openThreads" | "checksFailing" | "checksPending" | "watched" | "involved", string>;
  vote: Record<Vote, string>;
  /** status of a CI run: queued/running, or how it ended */
  run: Record<Exclude<RunStatus, "completed"> | RunConclusion, string>;
  mute: string;
  unmute: string;
  watch: {
    button: string;
    title: string;
    help: string;
    placeholder: string;
    add: string;
    remove: string;
    empty: string;
  };
  herdr: {
    section: string;
    other: string;
    empty: string;
    noAgent: string;
    status: Record<AgentStatus, string>;
    focus: string;
    open: string;
    hintBlocked: (agent: string) => string;
    hintDone: (agent: string) => string;
    start: {
      button: string;
      send: string;
      sentTitle: string;
      title: string;
      label: string;
      prompt: string;
      create: string;
      starting: string;
      noWorkdir: string;
      needsAnswer: string;
    };
    dialog: {
      chat: string;
      terminal: string;
      /** {n} tool calls in a row */
      toolSteps: string;
      send: string;
      placeholder: string;
      blockedNote: string;
    };
  };
  hint: {
    reviewerRejected: (name: string, title: string) => string;
    reviewerWaiting: (name: string, title: string) => string;
    openThreads: (n: number, title: string) => string;
    conflicts: (title: string) => string;
    checksFailing: (title: string) => string;
    readyToMerge: (title: string) => string;
    reviewRequested: (author: string, title: string) => string;
    ticketToMove: (prs: string[], status: string) => string;
    feedback: (author: string, text: string) => string;
    runFailed: (name: string, branch: string) => string;
  };
  change: {
    reviewRequest: (title: string) => string;
    from: (author: string) => string;
    merged: (title: string) => string;
    comment: (author: string, subject: string) => string;
    prGone: (title: string) => string;
    prGoneDetail: string;
    checksFailed: (title: string) => string;
    checksPassed: (title: string) => string;
    issueAdded: (summary: string) => string;
    issueRemoved: (summary: string) => string;
    issueRemovedDetail: string;
    runFinished: (name: string, result: string) => string;
  };
  /** used by the browser script; {n} gets replaced */
  client: {
    now: string;
    minutes: string;
    hours: string;
    yesterday: string;
    days: string;
    unseen: string;
    soundOff: string;
    soundOn: string;
    soundClick: string;
    connecting: string;
    live: string;
    polling: string;
    offline: string;
    watchErrors: Record<"unsupported" | "exists" | "failed", string>;
    agentErrors: Record<"agent_blocked" | "agent_not_found" | "failed", string>;
  };
};

const en: Dict = {
  locale: "en-GB",
  title: "Dev Dashboard",
  asOf: "As of",
  refresh: "Refresh now",
  seenAll: "Mark all seen",
  markSeen: "Mark as seen (opening the link does that too)",
  soundTitle: "Sound on new changes",
  switchLang: "Deutsch",
  firstPoll: "First poll running…",
  staleSuffix: "showing last known state.",
  required: "required",
  updated: "updated",
  mergedSuffix: "merged",
  by: (author) => `by ${author}`,
  tabs: { home: "Dashboard", prs: "Pull Requests", issues: "Issues", runs: "CI/CD Runs", spaces: "Spaces" },
  sections: {
    todo: "To do",
    changes: "Changes",
    myPrs: "My PRs",
    reviews: "Reviews for me",
    involved: "Involved & watched",
    tickets: "Tickets",
    runs: "Runs",
    merged: "Recently merged",
    muted: "Muted",
  },
  empty: {
    todo: "Nothing open.",
    changes: "No changes since the first run yet.",
    myPrs: "No open PRs.",
    reviews: "No review requests.",
    involved: "Nothing else you're involved in.",
    tickets: "No tickets for the JQL.",
    runs: "No runs in the last hours.",
  },
  levels: { action: "Action", ready: "Ready", info: "Info" },
  reasons: {
    rejected: "Reviewer rejected",
    waiting: "Reviewer waits for you",
    threads: "Open comment threads",
    conflicts: "Merge conflicts",
    checks: "Checks failing",
    ready: "Ready to merge",
    review: "Review requested",
    "move-ticket": "Ticket to move on",
    feedback: "Unanswered comment",
    "run-failed": "Run failed",
    "agent-blocked": "Agent waits for you",
    "agent-done": "Agent is done",
  },
  badges: {
    draft: "Draft",
    conflicts: "Conflicts",
    openThreads: "Open comment threads",
    checksFailing: "Checks failing",
    checksPending: "Checks running",
    watched: "watched",
    involved: "involved",
  },
  vote: {
    approved: "approved",
    approvedWithSuggestions: "approved with suggestions",
    none: "no vote",
    waiting: "waiting for author",
    rejected: "rejected",
  },
  run: {
    queued: "queued",
    running: "running",
    success: "succeeded",
    failure: "failed",
    cancelled: "cancelled",
    skipped: "skipped",
    neutral: "finished",
  },
  mute: "Mute – no sound, not counted as new",
  unmute: "Unmute",
  watch: {
    button: "+ Watch",
    title: "Watch something",
    help: "Paste a link to a PR, issue or CI run (GitHub, Azure DevOps, Jira). You'll get its updates like your own.",
    placeholder: "https://…",
    add: "Add",
    remove: "Stop watching",
    empty: "Nothing watched yet.",
  },
  herdr: {
    section: "Spaces with a ticket",
    other: "Other spaces",
    empty: "No herdr spaces.",
    noAgent: "no agent",
    status: { idle: "idle", working: "working", blocked: "waiting for you", done: "done", unknown: "?" },
    focus: "Show in herdr",
    open: "Output & reply",
    hintBlocked: (agent) => `${agent} is waiting for your answer`,
    hintDone: (agent) => `${agent} is done`,
    start: {
      button: "Start a herdr space with an agent",
      send: "Send to the agent",
      sentTitle: "Sent to the agent – click to send again",
      title: "New space",
      label: "Name",
      prompt: "First prompt",
      create: "Create space & start",
      starting: "Starting the agent…",
      noWorkdir: "No agent yet – set HERDR_WORKDIR to start spaces from here.",
      needsAnswer: "The agent asks something first – answer it in herdr (or the Terminal tab), then send the prompt.",
    },
    dialog: {
      chat: "Chat",
      terminal: "Terminal",
      toolSteps: "{n} steps",
      send: "Send",
      placeholder: "Message to the agent – Enter sends, Shift+Enter for a new line",
      blockedNote: "The agent is waiting at a question or approval – answer that in herdr.",
    },
  },
  hint: {
    reviewerRejected: (name, title) => `${name} rejected: ${title}`,
    reviewerWaiting: (name, title) => `${name} is waiting for you: ${title}`,
    openThreads: (n, title) => `${n} open comment thread${n === 1 ? "" : "s"}: ${title}`,
    conflicts: (title) => `Merge conflicts: ${title}`,
    checksFailing: (title) => `Checks failing: ${title}`,
    readyToMerge: (title) => `Ready to merge: ${title}`,
    reviewRequested: (author, title) => `Review requested (${author}): ${title}`,
    ticketToMove: (prs, status) =>
      `${prs.join(", ")} ${prs.length === 1 ? "is" : "are"} merged, ticket is still in “${status}” – move it on?`,
    feedback: (author, text) => `Feedback from ${author}: “${text}”`,
    runFailed: (name, branch) => `Run failed: ${name}${branch ? ` (${branch})` : ""}`,
  },
  change: {
    reviewRequest: (title) => `Review requested: ${title}`,
    from: (author) => `from ${author}`,
    merged: (title) => `Merged: ${title}`,
    comment: (author, subject) => `${author} commented on “${subject}”`,
    prGone: (title) => `No longer open: ${title}`,
    prGoneDetail: "merged, abandoned or reviewer removed",
    checksFailed: (title) => `Checks failed: ${title}`,
    checksPassed: (title) => `Checks passed: ${title}`,
    issueAdded: (summary) => `New in your list: ${summary}`,
    issueRemoved: (summary) => `No longer in your list: ${summary}`,
    issueRemovedDetail: "sprint changed, reassigned or done",
    runFinished: (name, result) => `${name}: ${result}`,
  },
  client: {
    now: "just now",
    minutes: "{n} min ago",
    hours: "{n} h ago",
    yesterday: "yesterday",
    days: "{n} days ago",
    unseen: "{n} new",
    soundOff: "🔕 Sound off",
    soundOn: "🔔 Sound on",
    soundClick: "🔔 Click to enable",
    connecting: "connecting…",
    live: "live",
    polling: "updating…",
    offline: "offline – reconnecting…",
    watchErrors: {
      unsupported: "Link not recognized – it has to point to a PR, issue or run of a configured source.",
      exists: "Already watched.",
      failed: "Couldn't add it, see the server log.",
    },
    agentErrors: {
      agent_blocked: "The agent is waiting at a question – answer it in herdr.",
      agent_not_found: "That agent is gone.",
      failed: "Didn't work, see the server log.",
    },
  },
};

const de: Dict = {
  locale: "de-AT",
  title: "Dev-Dashboard",
  asOf: "Stand",
  refresh: "Jetzt aktualisieren",
  seenAll: "Alles gesehen",
  markSeen: "Als gesehen markieren (Link öffnen macht das auch)",
  soundTitle: "Ton bei neuen Änderungen",
  switchLang: "English",
  firstPoll: "Erster Abruf läuft…",
  staleSuffix: "zeige letzten bekannten Stand.",
  required: "Pflicht",
  updated: "aktualisiert",
  mergedSuffix: "gemerged",
  by: (author) => `von ${author}`,
  tabs: { home: "Dashboard", prs: "Pull Requests", issues: "Issues", runs: "CI/CD-Runs", spaces: "Spaces" },
  sections: {
    todo: "Zu tun",
    changes: "Änderungen",
    myPrs: "Meine PRs",
    reviews: "Reviews für mich",
    involved: "Beteiligt & beobachtet",
    tickets: "Tickets",
    runs: "Runs",
    merged: "Kürzlich gemerged",
    muted: "Stummgeschaltet",
  },
  empty: {
    todo: "Nichts offen.",
    changes: "Noch keine Änderungen seit dem ersten Lauf.",
    myPrs: "Keine offenen PRs.",
    reviews: "Keine Reviews angefragt.",
    involved: "Sonst nirgends beteiligt.",
    tickets: "Keine Tickets für die JQL.",
    runs: "Keine Runs in den letzten Stunden.",
  },
  levels: { action: "Aktion", ready: "Bereit", info: "Info" },
  reasons: {
    rejected: "Reviewer hat abgelehnt",
    waiting: "Reviewer wartet auf dich",
    threads: "Offene Kommentar-Threads",
    conflicts: "Merge-Konflikte",
    checks: "Checks schlagen fehl",
    ready: "Bereit zum Mergen",
    review: "Review angefragt",
    "move-ticket": "Ticket weiterschieben",
    feedback: "Unbeantworteter Kommentar",
    "run-failed": "Run fehlgeschlagen",
    "agent-blocked": "Agent wartet auf dich",
    "agent-done": "Agent ist fertig",
  },
  badges: {
    draft: "Entwurf",
    conflicts: "Konflikte",
    openThreads: "Offene Kommentar-Threads",
    checksFailing: "Checks rot",
    checksPending: "Checks laufen",
    watched: "beobachtet",
    involved: "beteiligt",
  },
  vote: {
    approved: "approved",
    approvedWithSuggestions: "approved mit Vorschlägen",
    none: "kein Vote",
    waiting: "wartet auf Autor",
    rejected: "rejected",
  },
  run: {
    queued: "wartet",
    running: "läuft",
    success: "erfolgreich",
    failure: "fehlgeschlagen",
    cancelled: "abgebrochen",
    skipped: "übersprungen",
    neutral: "fertig",
  },
  mute: "Stummschalten – kein Ton, zählt nicht als neu",
  unmute: "Wieder laut",
  watch: {
    button: "+ Beobachten",
    title: "Etwas beobachten",
    help: "Link zu einem PR, Issue oder CI-Run einfügen (GitHub, Azure DevOps, Jira). Updates kommen dann wie bei deinen eigenen.",
    placeholder: "https://…",
    add: "Hinzufügen",
    remove: "Nicht mehr beobachten",
    empty: "Noch nichts beobachtet.",
  },
  herdr: {
    section: "Spaces mit Ticket",
    other: "Andere Spaces",
    empty: "Keine herdr-Spaces.",
    noAgent: "kein Agent",
    status: { idle: "bereit", working: "arbeitet", blocked: "wartet auf dich", done: "fertig", unknown: "?" },
    focus: "In herdr zeigen",
    open: "Ausgabe & antworten",
    hintBlocked: (agent) => `${agent} wartet auf deine Antwort`,
    hintDone: (agent) => `${agent} ist fertig`,
    start: {
      button: "herdr-Space mit Agent starten",
      send: "An den Agent schicken",
      sentTitle: "An den Agent geschickt – Klick schickt nochmal",
      title: "Neuer Space",
      label: "Name",
      prompt: "Erster Prompt",
      create: "Space anlegen & starten",
      starting: "Agent startet…",
      noWorkdir: "Noch kein Agent – mit HERDR_WORKDIR lassen sich hier Spaces starten.",
      needsAnswer: "Der Agent fragt zuerst etwas – in herdr (oder im Terminal-Tab) beantworten, dann den Prompt senden.",
    },
    dialog: {
      chat: "Chat",
      terminal: "Terminal",
      toolSteps: "{n} Schritte",
      send: "Senden",
      placeholder: "Nachricht an den Agent – Enter sendet, Shift+Enter für eine neue Zeile",
      blockedNote: "Der Agent wartet auf eine Frage oder Freigabe – die bitte in herdr beantworten.",
    },
  },
  hint: {
    reviewerRejected: (name, title) => `${name} hat abgelehnt: ${title}`,
    reviewerWaiting: (name, title) => `${name} wartet auf dich: ${title}`,
    openThreads: (n, title) => `${n} offene${n === 1 ? "r" : ""} Kommentar-Thread${n === 1 ? "" : "s"}: ${title}`,
    conflicts: (title) => `Merge-Konflikte: ${title}`,
    checksFailing: (title) => `Checks rot: ${title}`,
    readyToMerge: (title) => `Bereit zum Mergen: ${title}`,
    reviewRequested: (author, title) => `Review von dir angefragt (${author}): ${title}`,
    ticketToMove: (prs, status) =>
      `${prs.join(", ")} ${prs.length === 1 ? "ist" : "sind"} gemerged, Ticket steht noch auf „${status}“ – weiterschieben?`,
    feedback: (author, text) => `Feedback von ${author}: „${text}“`,
    runFailed: (name, branch) => `Run fehlgeschlagen: ${name}${branch ? ` (${branch})` : ""}`,
  },
  change: {
    reviewRequest: (title) => `Review angefragt: ${title}`,
    from: (author) => `von ${author}`,
    merged: (title) => `Gemerged: ${title}`,
    comment: (author, subject) => `${author} kommentiert „${subject}“`,
    prGone: (title) => `Nicht mehr offen: ${title}`,
    prGoneDetail: "gemerged, abgebrochen oder Reviewer entfernt",
    checksFailed: (title) => `Checks rot: ${title}`,
    checksPassed: (title) => `Checks grün: ${title}`,
    issueAdded: (summary) => `Neu in deiner Liste: ${summary}`,
    issueRemoved: (summary) => `Nicht mehr in deiner Liste: ${summary}`,
    issueRemovedDetail: "Sprint gewechselt, umgehängt oder erledigt",
    runFinished: (name, result) => `${name}: ${result}`,
  },
  client: {
    now: "gerade eben",
    minutes: "vor {n} Min",
    hours: "vor {n} Std",
    yesterday: "gestern",
    days: "vor {n} Tagen",
    unseen: "{n} neu",
    soundOff: "🔕 Ton aus",
    soundOn: "🔔 Ton an",
    soundClick: "🔔 Klick zum Aktivieren",
    connecting: "verbinde…",
    live: "live",
    polling: "aktualisiere…",
    offline: "offline – verbinde neu…",
    watchErrors: {
      unsupported: "Link nicht erkannt – er muss auf einen PR, ein Issue oder einen Run einer konfigurierten Quelle zeigen.",
      exists: "Wird schon beobachtet.",
      failed: "Konnte nicht hinzugefügt werden, siehe Server-Log.",
    },
    agentErrors: {
      agent_blocked: "Der Agent wartet auf eine Frage – bitte in herdr beantworten.",
      agent_not_found: "Den Agent gibt's nicht mehr.",
      failed: "Hat nicht geklappt, siehe Server-Log.",
    },
  },
};

export const dict = (lang: Lang): Dict => (lang === "de" ? de : en);
