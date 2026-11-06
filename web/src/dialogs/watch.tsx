import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/store";
import { useUi } from "@/lib/ui";

type Watch = { id: string; url: string; title?: string };

/** Paste the link of a PR, issue or run of any configured source to follow it. */
export function WatchDialog() {
  const t = useT();
  const open = useUi((s) => s.watch);
  const setUi = useUi((s) => s.set);
  const [list, setList] = useState<Watch[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const load = () => api<Watch[]>("GET", "/api/watches").then(setList, () => {});
  useEffect(() => {
    if (open) {
      setError("");
      void load();
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => setUi({ watch: o })}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.watch.title}</DialogTitle>
          <DialogDescription>{t.watch.help}</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            api("POST", "/api/watches", { url }).then(
              () => {
                setUrl("");
                void load();
              },
              (err: { error?: keyof typeof t.client.watchErrors }) => setError(t.client.watchErrors[err?.error ?? "failed"] ?? t.client.watchErrors.failed),
            );
          }}
        >
          <Input type="url" required autoComplete="off" placeholder={t.watch.placeholder} value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
          <Button type="submit">{t.watch.add}</Button>
        </form>
        {error && <p className="text-sm text-bad">{error}</p>}
        <ul className="divide-y rounded-md border text-sm">
          {list.length ? (
            list.map((w) => (
              <li key={w.id} className="flex items-center gap-2 px-3 py-2">
                <a href={w.url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate hover:text-primary">
                  {w.title || w.url}
                </a>
                <Button variant="ghost" size="icon-sm" aria-label={t.watch.remove} title={t.watch.remove} onClick={() => api("DELETE", `/api/watches?id=${encodeURIComponent(w.id)}`).then(load, () => {})}>
                  <XIcon />
                </Button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-muted-foreground">{t.watch.empty}</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
