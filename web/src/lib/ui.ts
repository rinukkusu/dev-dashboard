import type { AgentStatus } from "@shared/model.ts";
import { create } from "zustand";
import { api } from "./store.ts";

/** Agents to choose from when a ticket/PR has several (one per tab), and spaces to open a new tab in. */
export type Choice = {
  kind: string;
  id: string;
  candidates: { pane: string; label: string; tab?: string; title?: string; status: AgentStatus }[];
  spaces: { id: string; label: string }[];
};

export type AgentOpen = {
  pane: string;
  label: string;
  /** a prompt to look over before sending */
  prefill?: string;
  /** change id of the comment the prompt is about, so its ➤ gets a ✓ */
  comment?: string;
  /** shown above the input, e.g. "answer the agent's question first" */
  note?: string;
  choice?: Choice;
};

export type StartOpen = { kind: string; id: string; label: string; prompt: string; canStart: boolean; error?: string };

/** Which dialog is open, so any button anywhere can open one. */
type Ui = {
  agent?: AgentOpen;
  threads?: string;
  start?: StartOpen;
  watch: boolean;
  /** the activity feed as a panel, on screens too narrow for its column */
  activity: boolean;
  /** Ctrl+K search, and the list of shortcuts */
  palette: boolean;
  keys: boolean;
  openAgent(a: AgentOpen): void;
  set(p: Partial<Pick<Ui, "agent" | "threads" | "start" | "watch" | "activity" | "palette" | "keys">>): void;
};

export const useUi = create<Ui>((set) => ({
  watch: false,
  activity: false,
  palette: false,
  keys: false,
  openAgent: (agent) => set({ agent, start: undefined, threads: undefined }),
  set: (p) => set(p),
}));

type Prepared = {
  label: string;
  prompt: string;
  canStart: boolean;
  agent?: { pane: string; label: string };
  candidates?: Choice["candidates"];
  spaces?: Choice["spaces"];
};

/**
 * 🤖 + on a ticket/PR, ➤ on a comment: if it has an agent already, the prompt goes into that agent's
 * chat to look over; otherwise the dialog for a new space opens, prefilled from prompts.json.
 */
export async function prepareStart(kind: "ticket" | "pr" | "comment", id: string, errorText: (e: unknown) => string) {
  const ui = useUi.getState();
  try {
    const r = await api<Prepared>("GET", `/api/herdr/prepare?kind=${kind}&id=${encodeURIComponent(id)}`);
    if (r.agent) {
      ui.openAgent({
        pane: r.agent.pane,
        label: r.agent.label,
        prefill: r.prompt,
        comment: kind === "comment" ? id : undefined,
        choice: { kind, id, candidates: r.candidates ?? [], spaces: r.spaces ?? [] },
      });
    } else {
      ui.set({ start: { kind, id, label: r.label, prompt: r.prompt, canStart: r.canStart } });
    }
  } catch (e) {
    ui.set({ start: { kind, id, label: "", prompt: "", canStart: false, error: errorText(e) } });
  }
}

/** The texts of the herdr API's error codes. */
export const agentError = (errors: Record<string, string>, e: unknown) => {
  const code = (e as { error?: string } | undefined)?.error;
  return (code && errors[code]) || errors.failed || "failed";
};
