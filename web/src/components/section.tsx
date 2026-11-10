import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useSection } from "@/lib/sections";
import { cn } from "@/lib/utils";

/**
 * A list with a heading you can click to fold it; the browser remembers that per `id`.
 * `defaultOpen: false` for lists that are rarely interesting (recently merged, muted).
 */
export function Section({ id, title, count, empty, defaultOpen = true, actions, children }: {
  id: string;
  title: string;
  count: number;
  empty?: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useSection(id, defaultOpen);
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2 px-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          {title}
          {count > 0 && <span className="tabular-nums opacity-70">{count}</span>}
        </button>
        <span className="flex-1" />
        {actions}
      </div>
      {open && (count ? children : empty ? <p className="px-1 text-sm text-muted-foreground">{empty}</p> : null)}
    </section>
  );
}

/** The bordered list most pages use. */
export const Rows = ({ children }: { children: ReactNode }) => <ul className="divide-y overflow-hidden rounded-lg border bg-card">{children}</ul>;
