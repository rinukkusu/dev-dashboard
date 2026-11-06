import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/ui";

/** "?": what the keyboard can do. */
export function KeysDialog() {
  const t = useT();
  const open = useUi((s) => s.keys);
  const set = useUi((s) => s.set);
  return (
    <Dialog open={open} onOpenChange={(o) => set({ keys: o })}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.app.keys.title}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {t.app.keys.list.map(([keys, text]) => (
            <div key={keys} className="contents">
              <dt className="flex gap-1">
                {keys.split(/\s{2,}/).map((k) => (
                  <kbd key={k} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
