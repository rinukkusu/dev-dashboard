import type { AgentJob, AgentStatus, Change, HintLevel, HintReason, RunConclusion, RunStatus, Vote } from "./model.ts";

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
  firstPoll: string;
  staleSuffix: string;
  required: string;
  updated: string;
  mergedSuffix: string;
  storyPoints: string;
  /** time cockpit hours on a ticket card */
  booked: { title: string; hours: (h: string) => string; budget: (points: string, perPoint: string) => string };
  by: (author: string) => string;
  /** texts only the web app (web/) uses */
  app: {
    nav: Record<"inbox" | "board" | "prs" | "issues" | "runs" | "spaces", string>;
    /** inbox headings, by the most urgent hint of an item */
    levels: Record<HintLevel, string>;
    inboxEmpty: string;
    settings: string;
    language: string;
    /** the feed's filters and grouped entries */
    feed: { all: string; unseen: string; runs: string; hideRuns: string; more: (n: number) => string; less: string; noneUnseen: string };
    /** below the inbox: what waits on others, what agents are doing */
    waitingOthers: string;
    agentsWorking: string;
    palette: { button: string; placeholder: string; empty: string; pages: string; prs: string; issues: string; runs: string; spaces: string };
    keys: { title: string; button: string; list: [keys: string, text: string][] };
    notify: { label: string; on: string; off: string; denied: string; unsupported: string };
  };
  sections: Record<"changes" | "myPrs" | "reviews" | "involved" | "tickets" | "runs" | "merged" | "muted", string>;
  empty: Record<"changes" | "myPrs" | "reviews" | "involved" | "tickets" | "runs", string>;
  /** tooltip of a to-do's icon */
  reasons: Record<HintReason, string>;
  badges: Record<"draft" | "conflicts" | "openThreads" | "comments" | "commentsOpen" | "checksFailing" | "checksPending" | "watched", string>;
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
      /** the dialog's target picker: which agent (tab) gets it, or a new tab */
      target: string;
      /** {space} = its name */
      newTab: string;
      newTabNote: string;
      /** name of a tab started from the dialog */
      tabLabel: string;
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
  /** comments handed to agents on their own (autopilot) */
  auto: {
    /** to-do text of a job that has no other to-do to join */
    hint: Record<AgentJob["status"], string>;
    /** tooltip/heading of the 🤖 on a to-do */
    status: Record<AgentJob["status"], string>;
    comments: (n: number) => string;
    artifact: string;
    read: string;
    open: string;
    /** why a queued job isn't sent yet */
    waiting: Record<NonNullable<AgentJob["waiting"]>, string>;
  };
  /** a PR's open threads, with replies to write or the agent's proposals to post */
  threads: {
    /** the 💬 on a to-do */
    button: string;
    /** in the 🤖 popover; {n} proposals */
    review: string;
    /** a thread not on a line of code */
    general: string;
    loading: string;
    none: string;
    /** the source can't post (GitHub, Jira) – only reading */
    readOnly: string;
    suggestion: string;
    placeholder: string;
    resolve: string;
    send: string;
    sending: string;
    sent: string;
    me: string;
    failed: string;
    resolved: string;
    /** label above a suggested change in a comment */
    suggested: string;
    noDiff: string;
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
    soundOff: string;
    soundOn: string;
    soundClick: string;
    connecting: string;
    live: string;
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
  markSeen: "New – click to mark as seen (opening the link does that too)",
  soundTitle: "Sound on new changes",
  firstPoll: "First poll running…",
  staleSuffix: "showing last known state.",
  required: "required",
  updated: "updated",
  mergedSuffix: "merged",
  storyPoints: "Story points",
  booked: {
    title: "Booked in time cockpit",
    hours: (h) => `${h} h booked`,
    budget: (points, perPoint) => `Booked in time cockpit vs. ${points} SP × ${perPoint} h`,
  },
  by: (author) => `by ${author}`,
  app: {
    nav: { inbox: "Inbox", board: "Board", prs: "Pull requests", issues: "Issues", runs: "Runs", spaces: "Spaces" },
    levels: { action: "Needs you", ready: "Ready to go", info: "In progress" },
    inboxEmpty: "Nothing wants anything from you right now.",
    settings: "Settings",
    language: "Language",
    feed: { all: "All", unseen: "New", runs: "Show runs", hideRuns: "Hide runs", more: (n) => `+${n} more`, less: "less", noneUnseen: "Nothing new." },
    waitingOthers: "Waiting on others",
    agentsWorking: "Agents at work",
    palette: { button: "Search", placeholder: "PR, ticket, run, space or page …", empty: "Nothing found.", pages: "Pages", prs: "Pull requests", issues: "Issues", runs: "Runs", spaces: "Spaces" },
    keys: {
      title: "Keyboard shortcuts",
      button: "Shortcuts",
      list: [
        ["Ctrl K  /", "Search and open anything"],
        ["j  k", "Next / previous inbox entry"],
        ["Enter  o", "Open it (agents: their chat)"],
        ["e", "Mark its changes seen"],
        ["m", "Mute / unmute it"],
        ["t", "Open its comment threads"],
        ["1 … 6", "Go to page"],
        ["?", "This list"],
      ],
    },
    notify: { label: "Desktop notifications", on: "on", off: "off", denied: "blocked by the browser", unsupported: "not supported" },
  },
  sections: {
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
    changes: "No changes since the first run yet.",
    myPrs: "No open PRs.",
    reviews: "No review requests.",
    involved: "Nothing else you're involved in.",
    tickets: "No tickets for the JQL.",
    runs: "No runs in the last hours.",
  },
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
    "agent-reply": "Agent worked through new comments",
  },
  badges: {
    draft: "Draft",
    conflicts: "Conflicts",
    openThreads: "Open comment threads",
    comments: "Comments",
    commentsOpen: "Comments – the last one isn't yours",
    checksFailing: "Checks failing",
    checksPending: "Checks running",
    watched: "watched",
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
    help: "Paste a link to a PR, issue or CI run (GitHub, GitLab, Azure DevOps, Jira). You'll get its updates like your own.",
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
      target: "To",
      newTab: "+ new tab in {space}",
      newTabNote: "Sending starts a new tab with an agent in this space.",
      tabLabel: "comments",
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
  auto: {
    hint: {
      collecting: "New comments – the agent gets them in a moment",
      queued: "New comments – waiting for a free agent",
      sent: "Agent is working through the new comments",
      answered: "Agent's answer to the new comments is ready",
      failed: "Handing the new comments to an agent failed",
    },
    status: {
      collecting: "collecting comments",
      queued: "waiting for the agent",
      sent: "agent is working on it",
      answered: "answer ready",
      failed: "failed",
    },
    comments: (n) => `${n} comment${n === 1 ? "" : "s"}`,
    artifact: "📊 Open presentation",
    read: "✓ Read",
    open: "Open chat",
    waiting: {
      busy: "the agent is still working",
      blocked: "the agent asks something – answer it in herdr",
    },
  },
  threads: {
    button: "Show open threads",
    review: "💬 Review proposed replies ({n})",
    general: "General",
    loading: "Loading…",
    none: "No open threads.",
    readOnly: "Replying from here isn't possible for this source – open the PR to answer.",
    suggestion: "🤖 proposed by the agent – edit as you like",
    placeholder: "Your reply…",
    resolve: "resolve thread",
    send: "Reply",
    sending: "Posting…",
    sent: "✓ Posted",
    resolved: "✓ Posted and resolved",
    me: "me",
    failed: "Posting failed",
    suggested: "Suggested change",
    noDiff: "The code of this thread couldn't be loaded.",
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
    soundOff: "🔕 Sound off",
    soundOn: "🔔 Sound on",
    soundClick: "🔔 Click to enable",
    connecting: "connecting…",
    live: "live",
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
  markSeen: "Neu – klicken zum Als-gesehen-Markieren (Link öffnen macht das auch)",
  soundTitle: "Ton bei neuen Änderungen",
  firstPoll: "Erster Abruf läuft…",
  staleSuffix: "zeige letzten bekannten Stand.",
  required: "Pflicht",
  updated: "aktualisiert",
  mergedSuffix: "gemerged",
  storyPoints: "Story Points",
  booked: {
    title: "In time cockpit gebucht",
    hours: (h) => `${h} h gebucht`,
    budget: (points, perPoint) => `In time cockpit gebucht vs. ${points} SP × ${perPoint} h`,
  },
  by: (author) => `von ${author}`,
  app: {
    nav: { inbox: "Inbox", board: "Board", prs: "Pull Requests", issues: "Issues", runs: "Runs", spaces: "Spaces" },
    levels: { action: "Braucht dich", ready: "Bereit", info: "Läuft" },
    inboxEmpty: "Gerade will nichts etwas von dir.",
    settings: "Einstellungen",
    language: "Sprache",
    feed: { all: "Alle", unseen: "Neu", runs: "Runs zeigen", hideRuns: "Runs ausblenden", more: (n) => `+${n} weitere`, less: "weniger", noneUnseen: "Nichts Neues." },
    waitingOthers: "Wartet auf andere",
    agentsWorking: "Agents bei der Arbeit",
    palette: { button: "Suchen", placeholder: "PR, Ticket, Run, Space oder Seite …", empty: "Nichts gefunden.", pages: "Seiten", prs: "Pull Requests", issues: "Issues", runs: "Runs", spaces: "Spaces" },
    keys: {
      title: "Tastenkürzel",
      button: "Tastenkürzel",
      list: [
        ["Strg K  /", "Alles suchen und öffnen"],
        ["j  k", "Nächster / vorheriger Inbox-Eintrag"],
        ["Enter  o", "Öffnen (Agents: ihr Chat)"],
        ["e", "Seine Änderungen als gesehen markieren"],
        ["m", "Stummschalten / wieder an"],
        ["t", "Kommentar-Threads öffnen"],
        ["1 … 6", "Seite wechseln"],
        ["?", "Diese Liste"],
      ],
    },
    notify: { label: "Desktop-Benachrichtigungen", on: "an", off: "aus", denied: "vom Browser blockiert", unsupported: "nicht unterstützt" },
  },
  sections: {
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
    changes: "Noch keine Änderungen seit dem ersten Lauf.",
    myPrs: "Keine offenen PRs.",
    reviews: "Keine Reviews angefragt.",
    involved: "Sonst nirgends beteiligt.",
    tickets: "Keine Tickets für die JQL.",
    runs: "Keine Runs in den letzten Stunden.",
  },
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
    "agent-reply": "Agent hat neue Kommentare bearbeitet",
  },
  badges: {
    draft: "Entwurf",
    conflicts: "Konflikte",
    openThreads: "Offene Kommentar-Threads",
    comments: "Kommentare",
    commentsOpen: "Kommentare – der letzte ist nicht von dir",
    checksFailing: "Checks rot",
    checksPending: "Checks laufen",
    watched: "beobachtet",
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
    help: "Link zu einem PR, Issue oder CI-Run einfügen (GitHub, GitLab, Azure DevOps, Jira). Updates kommen dann wie bei deinen eigenen.",
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
      target: "An",
      newTab: "+ neuer Tab in {space}",
      newTabNote: "Senden startet einen neuen Tab mit Agent in diesem Space.",
      tabLabel: "Kommentare",
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
  auto: {
    hint: {
      collecting: "Neue Kommentare – gehen gleich an den Agent",
      queued: "Neue Kommentare – warten auf einen freien Agent",
      sent: "Agent bearbeitet die neuen Kommentare",
      answered: "Antwort des Agents zu den neuen Kommentaren ist da",
      failed: "Übergabe der neuen Kommentare an einen Agent fehlgeschlagen",
    },
    status: {
      collecting: "sammelt Kommentare",
      queued: "wartet auf den Agent",
      sent: "Agent arbeitet daran",
      answered: "Antwort ist da",
      failed: "fehlgeschlagen",
    },
    comments: (n) => `${n} Kommentar${n === 1 ? "" : "e"}`,
    artifact: "📊 Präsentation öffnen",
    read: "✓ Gelesen",
    open: "Chat öffnen",
    waiting: {
      busy: "der Agent arbeitet noch",
      blocked: "der Agent fragt etwas – in herdr beantworten",
    },
  },
  threads: {
    button: "Offene Threads anzeigen",
    review: "💬 Antwortvorschläge prüfen ({n})",
    general: "Allgemein",
    loading: "Lädt…",
    none: "Keine offenen Threads.",
    readOnly: "Antworten geht von hier aus für diese Quelle nicht – zum Antworten den PR öffnen.",
    suggestion: "🤖 Vorschlag des Agents – nach Belieben anpassen",
    placeholder: "Deine Antwort…",
    resolve: "Thread auflösen",
    send: "Antworten",
    sending: "Wird gepostet…",
    sent: "✓ Gepostet",
    resolved: "✓ Gepostet und aufgelöst",
    me: "ich",
    failed: "Posten fehlgeschlagen",
    suggested: "Vorgeschlagene Änderung",
    noDiff: "Der Code zu diesem Thread konnte nicht geladen werden.",
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
    soundOff: "🔕 Ton aus",
    soundOn: "🔔 Ton an",
    soundClick: "🔔 Klick zum Aktivieren",
    connecting: "verbinde…",
    live: "live",
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

/**
 * A to-do's text as data – which text and its arguments – so the page can show it in its own
 * language: one of `hint`, an agent's state, or an autopilot job's.
 */
export type HintMsg =
  | { [K in keyof Dict["hint"]]: readonly [K, ...Parameters<Dict["hint"][K]>] }[keyof Dict["hint"]]
  | readonly ["agentBlocked" | "agentDone", string]
  | readonly ["job", AgentJob["status"], AgentJob["waiting"]?];

export function hintText(t: Dict, m: HintMsg): string {
  switch (m[0]) {
    case "agentBlocked":
      return t.herdr.hintBlocked(m[1]);
    case "agentDone":
      return t.herdr.hintDone(m[1]);
    case "job": {
      // (prefs.json may still hold a reason an older version wrote)
      const [, status, waiting] = m;
      return status === "queued" && waiting && t.auto.waiting[waiting] ? `${t.auto.hint.queued} (${t.auto.waiting[waiting]})` : t.auto.hint[status];
    }
    default:
      return (t.hint[m[0]] as (...args: unknown[]) => string)(...m.slice(1));
  }
}

/** Turns the stored facts of a change into text in the current language. */
export function changeText(ch: Change, t: Dict): { title: string; detail?: string } {
  if (ch.title !== undefined) return { title: ch.title, detail: ch.detail }; // pre-i18n entry
  switch (ch.kind) {
    case "pr-review-request":
      return { title: t.change.reviewRequest(ch.subject), detail: ch.actor && t.change.from(ch.actor) };
    case "pr-merged":
      return { title: t.change.merged(ch.subject) };
    case "pr-vote":
      return { title: `${ch.actor}: ${t.vote[ch.vote ?? "none"]}`, detail: ch.subject };
    case "pr-comment":
    case "issue-comment":
      return { title: t.change.comment(ch.actor ?? "?", ch.subject), detail: ch.text };
    case "pr-gone":
      return { title: t.change.prGone(ch.subject), detail: t.change.prGoneDetail };
    case "pr-checks":
      return { title: ch.checks === "failure" ? t.change.checksFailed(ch.subject) : t.change.checksPassed(ch.subject) };
    case "issue-status":
      return { title: `${ch.from} → ${ch.to}`, detail: ch.subject };
    case "issue-added":
      return { title: t.change.issueAdded(ch.subject), detail: ch.to };
    case "issue-removed":
      return { title: t.change.issueRemoved(ch.subject), detail: t.change.issueRemovedDetail };
    case "run-finished":
      return { title: t.change.runFinished(ch.subject, t.run[ch.conclusion ?? "neutral"]), detail: ch.text };
  }
}
