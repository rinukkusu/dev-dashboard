import { Command } from "cmdk";
import { SearchIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SourceIcon } from "@/components/source-icon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useData } from "@/lib/data";
import { PAGES } from "@/lib/hash";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/ui";

/** Ctrl+K: find a PR, ticket, run or space by number or title and open it; or jump to a page. */
export function Palette() {
  const t = useT();
  const open = useUi((s) => s.palette);
  const ui = useUi();
  const { view, lists } = useData();
  const close = () => ui.set({ palette: false });
  const go = (url: string) => {
    close();
    window.open(url, "_blank", "noopener");
  };
  const s = view.snapshot;
  const prs = [...s.prs].sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active"));
  return (
    <Dialog open={open} onOpenChange={(o) => ui.set({ palette: o })}>
      <DialogContent className="top-[20vh] flex max-w-xl translate-y-0 flex-col gap-0 overflow-hidden p-0 [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">{t.app.palette.button}</DialogTitle>
        <DialogDescription className="sr-only">{t.app.palette.placeholder}</DialogDescription>
        <Command loop className="flex max-h-[60vh] min-w-0 flex-col">
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input autoFocus placeholder={t.app.palette.placeholder} className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <Command.List className="min-h-0 overflow-y-auto p-1 [scrollbar-width:thin]">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">{t.app.palette.empty}</Command.Empty>
            <Group heading={t.app.palette.pages}>
              {PAGES.map((p, i) => (
                <Item key={p} value={`page ${t.app.nav[p]}`} onSelect={() => { close(); location.hash = p; }}>
                  <span className="flex-1">{t.app.nav[p]}</span>
                  <kbd className="text-xs text-muted-foreground">{i + 1}</kbd>
                </Item>
              ))}
            </Group>
            <Group heading={t.app.palette.prs}>
              {prs.map((p) => (
                <Item key={p.id} value={`${p.ref} ${p.title} ${p.repo} ${p.branch} ${p.id}`} onSelect={() => go(p.url)} icon={<SourceIcon resource={p.id} className="size-3.5" />}>
                  <Ref>{p.ref}</Ref>
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{p.repo}</span>
                </Item>
              ))}
            </Group>
            <Group heading={t.app.palette.issues}>
              {s.issues.map((i) => (
                <Item key={i.id} value={`${i.ref} ${i.title} ${i.id}`} onSelect={() => go(i.url)} icon={<SourceIcon resource={i.id} className="size-3.5" />}>
                  <Ref>{i.ref}</Ref>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{i.status}</span>
                </Item>
              ))}
            </Group>
            <Group heading={t.app.palette.spaces}>
              {lists.spaces.map((sp) => {
                const agent = sp.agents[0];
                return (
                  <Item
                    key={sp.id}
                    value={`space ${sp.number} ${sp.label} ${sp.id}`}
                    onSelect={() => {
                      close();
                      if (agent) ui.openAgent({ pane: agent.paneId, label: sp.label });
                      else location.hash = "spaces";
                    }}
                  >
                    <Ref>{sp.number}</Ref>
                    <span className="min-w-0 flex-1 truncate">{sp.label}</span>
                    {agent && <span className="shrink-0 text-xs text-muted-foreground">{t.herdr.status[agent.status]}</span>}
                  </Item>
                );
              })}
            </Group>
            <Group heading={t.app.palette.runs}>
              {lists.runs.map((r) => (
                <Item key={r.id} value={`${r.name} ${r.title} ${r.repo} ${r.branch ?? ""} ${r.id}`} onSelect={() => go(r.url)} icon={<SourceIcon resource={r.id} className="size-3.5" />}>
                  <Ref>{r.name}</Ref>
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t.run[r.status === "completed" ? (r.conclusion ?? "neutral") : r.status]}</span>
                </Item>
              ))}
            </Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

const Group = ({ heading, children }: { heading: string; children: ReactNode }) => (
  <Command.Group heading={heading} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
    {children}
  </Command.Group>
);

const Item = ({ value, onSelect, icon, children }: { value: string; onSelect: () => void; icon?: ReactNode; children: ReactNode }) => (
  <Command.Item value={value} onSelect={onSelect} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent">
    {icon}
    {children}
  </Command.Item>
);

const Ref = ({ children }: { children: ReactNode }) => <span className="shrink-0 font-mono text-xs text-muted-foreground">{children}</span>;
