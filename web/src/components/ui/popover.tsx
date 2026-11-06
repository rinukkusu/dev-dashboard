import { Popover as P } from "radix-ui";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const Popover = P.Root;
const PopoverTrigger = P.Trigger;
const PopoverAnchor = P.Anchor;

function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(36rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

/**
 * A popover that opens when you hover its trigger (and stays while the mouse is over it, so you can
 * select text or click a link) – or when you tap it on a touch screen.
 */
function HoverPop({ trigger, children, className }: { trigger: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 150);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 200);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onPointerEnter={enter} onPointerLeave={leave}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className={className} onPointerEnter={enter} onPointerLeave={leave} onOpenAutoFocus={(e) => e.preventDefault()}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export { HoverPop, Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
