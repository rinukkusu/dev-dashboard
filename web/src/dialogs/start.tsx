import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/store";
import { agentError, useUi } from "@/lib/ui";

/** Name and first prompt of a new herdr space, prefilled from prompts.json – nothing starts unseen. */
export function StartDialog() {
  const t = useT();
  const start = useUi((s) => s.start);
  const setUi = useUi((s) => s.set);
  const openAgent = useUi((s) => s.openAgent);
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!start) return;
    setLabel(start.label);
    setPrompt(start.prompt);
    setMsg(start.error ? { text: start.error, bad: true } : start.canStart ? undefined : { text: t.herdr.start.noWorkdir, bad: true });
  }, [start, t]);
  const errorText = (e: unknown) => ((e as { error?: string })?.error === "no-workdir" ? t.herdr.start.noWorkdir : agentError(t.client.agentErrors, e));
  return (
    <Dialog open={!!start} onOpenChange={(o) => !o && setUi({ start: undefined })}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.herdr.start.title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!start) return;
            setBusy(true);
            setMsg({ text: t.herdr.start.starting });
            api<{ pane: string; sent: boolean }>("POST", "/api/herdr/start", { kind: start.kind, id: start.id, label, prompt })
              .then((r) =>
                // asked something first (e.g. "trust this folder?"): the prompt waits in the chat box
                r.sent
                  ? openAgent({ pane: r.pane, label })
                  : openAgent({ pane: r.pane, label, prefill: prompt, comment: start.kind === "comment" ? start.id : undefined, note: t.herdr.start.needsAnswer }),
              )
              .catch((err) => setMsg({ text: errorText(err), bad: true }))
              .finally(() => setBusy(false));
          }}
        >
          <Label>
            {t.herdr.start.label}
            <Input required autoComplete="off" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Label>
          <Label>
            {t.herdr.start.prompt}
            <Textarea required rows={10} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="font-mono text-xs" autoFocus />
          </Label>
          <DialogFooter className="justify-between">
            <span className={msg?.bad ? "text-sm text-bad" : "text-sm text-muted-foreground"}>{msg?.text}</span>
            <Button type="submit" disabled={busy || !start?.canStart || !!start?.error}>
              {t.herdr.start.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
