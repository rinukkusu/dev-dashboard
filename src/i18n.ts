import type { HintLevel, Vote } from "./model.ts";

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
  soundTitle: string;
  switchLang: string;
  firstPoll: string;
  staleSuffix: string;
  required: string;
  updated: string;
  mergedSuffix: string;
  by: (author: string) => string;
  sections: Record<"todo" | "changes" | "myPrs" | "reviews" | "tickets" | "merged", string>;
  empty: Record<"todo" | "changes" | "myPrs" | "reviews" | "tickets", string>;
  levels: Record<HintLevel, string>;
  badges: Record<"draft" | "conflicts" | "openThreads", string>;
  vote: Record<Vote, string>;
  hint: {
    reviewerRejected: (name: string, title: string) => string;
    reviewerWaiting: (name: string, title: string) => string;
    openThreads: (n: number, title: string) => string;
    conflicts: (title: string) => string;
    readyToMerge: (title: string) => string;
    reviewRequested: (author: string, title: string) => string;
    ticketToMove: (prs: string[], status: string) => string;
    feedback: (author: string, text: string) => string;
  };
  change: {
    reviewRequest: (title: string) => string;
    from: (author: string) => string;
    merged: (title: string) => string;
    comment: (author: string, subject: string) => string;
    prGone: (title: string) => string;
    prGoneDetail: string;
    issueAdded: (summary: string) => string;
    issueRemoved: (summary: string) => string;
    issueRemovedDetail: string;
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
  };
};

const en: Dict = {
  locale: "en-GB",
  title: "Dev Dashboard",
  asOf: "As of",
  refresh: "Refresh now",
  seenAll: "Mark all seen",
  soundTitle: "Sound on new changes",
  switchLang: "Deutsch",
  firstPoll: "First poll running…",
  staleSuffix: "showing last known state.",
  required: "required",
  updated: "updated",
  mergedSuffix: "merged",
  by: (author) => `by ${author}`,
  sections: {
    todo: "To do",
    changes: "Changes",
    myPrs: "My PRs",
    reviews: "Reviews for me",
    tickets: "Tickets",
    merged: "Recently merged",
  },
  empty: {
    todo: "Nothing open.",
    changes: "No changes since the first run yet.",
    myPrs: "No open PRs.",
    reviews: "No review requests.",
    tickets: "No tickets for the JQL.",
  },
  levels: { action: "Action", ready: "Ready", info: "Info" },
  badges: { draft: "Draft", conflicts: "Conflicts", openThreads: "Open comment threads" },
  vote: {
    approved: "approved",
    approvedWithSuggestions: "approved with suggestions",
    none: "no vote",
    waiting: "waiting for author",
    rejected: "rejected",
  },
  hint: {
    reviewerRejected: (name, title) => `${name} rejected: ${title}`,
    reviewerWaiting: (name, title) => `${name} is waiting for you: ${title}`,
    openThreads: (n, title) => `${n} open comment thread${n === 1 ? "" : "s"}: ${title}`,
    conflicts: (title) => `Merge conflicts: ${title}`,
    readyToMerge: (title) => `Ready to merge: ${title}`,
    reviewRequested: (author, title) => `Review requested (${author}): ${title}`,
    ticketToMove: (prs, status) =>
      `${prs.join(", ")} ${prs.length === 1 ? "is" : "are"} merged, ticket is still in “${status}” – move it on?`,
    feedback: (author, text) => `Feedback from ${author}: “${text}”`,
  },
  change: {
    reviewRequest: (title) => `Review requested: ${title}`,
    from: (author) => `from ${author}`,
    merged: (title) => `Merged: ${title}`,
    comment: (author, subject) => `${author} commented on “${subject}”`,
    prGone: (title) => `No longer open: ${title}`,
    prGoneDetail: "merged, abandoned or reviewer removed",
    issueAdded: (summary) => `New in your list: ${summary}`,
    issueRemoved: (summary) => `No longer in your list: ${summary}`,
    issueRemovedDetail: "sprint changed, reassigned or done",
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
  },
};

const de: Dict = {
  locale: "de-AT",
  title: "Dev-Dashboard",
  asOf: "Stand",
  refresh: "Jetzt aktualisieren",
  seenAll: "Alles gesehen",
  soundTitle: "Ton bei neuen Änderungen",
  switchLang: "English",
  firstPoll: "Erster Abruf läuft…",
  staleSuffix: "zeige letzten bekannten Stand.",
  required: "Pflicht",
  updated: "aktualisiert",
  mergedSuffix: "gemerged",
  by: (author) => `von ${author}`,
  sections: {
    todo: "Zu tun",
    changes: "Änderungen",
    myPrs: "Meine PRs",
    reviews: "Reviews für mich",
    tickets: "Tickets",
    merged: "Kürzlich gemerged",
  },
  empty: {
    todo: "Nichts offen.",
    changes: "Noch keine Änderungen seit dem ersten Lauf.",
    myPrs: "Keine offenen PRs.",
    reviews: "Keine Reviews angefragt.",
    tickets: "Keine Tickets für die JQL.",
  },
  levels: { action: "Aktion", ready: "Bereit", info: "Info" },
  badges: { draft: "Entwurf", conflicts: "Konflikte", openThreads: "Offene Kommentar-Threads" },
  vote: {
    approved: "approved",
    approvedWithSuggestions: "approved mit Vorschlägen",
    none: "kein Vote",
    waiting: "wartet auf Autor",
    rejected: "rejected",
  },
  hint: {
    reviewerRejected: (name, title) => `${name} hat abgelehnt: ${title}`,
    reviewerWaiting: (name, title) => `${name} wartet auf dich: ${title}`,
    openThreads: (n, title) => `${n} offene${n === 1 ? "r" : ""} Kommentar-Thread${n === 1 ? "" : "s"}: ${title}`,
    conflicts: (title) => `Merge-Konflikte: ${title}`,
    readyToMerge: (title) => `Bereit zum Mergen: ${title}`,
    reviewRequested: (author, title) => `Review von dir angefragt (${author}): ${title}`,
    ticketToMove: (prs, status) =>
      `${prs.join(", ")} ${prs.length === 1 ? "ist" : "sind"} gemerged, Ticket steht noch auf „${status}“ – weiterschieben?`,
    feedback: (author, text) => `Feedback von ${author}: „${text}“`,
  },
  change: {
    reviewRequest: (title) => `Review angefragt: ${title}`,
    from: (author) => `von ${author}`,
    merged: (title) => `Gemerged: ${title}`,
    comment: (author, subject) => `${author} kommentiert „${subject}“`,
    prGone: (title) => `Nicht mehr offen: ${title}`,
    prGoneDetail: "gemerged, abgebrochen oder Reviewer entfernt",
    issueAdded: (summary) => `Neu in deiner Liste: ${summary}`,
    issueRemoved: (summary) => `Nicht mehr in deiner Liste: ${summary}`,
    issueRemovedDetail: "Sprint gewechselt, umgehängt oder erledigt",
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
  },
};

export const dict = (lang: Lang): Dict => (lang === "de" ? de : en);
