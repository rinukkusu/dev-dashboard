import { XIcon } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// A panel sliding in from the right: the agent chat, the activity feed on small screens.
const Sheet = D.Root;
const SheetTitle = ({ className, ...props }: ComponentProps<typeof D.Title>) => <D.Title className={cn("font-semibold", className)} {...props} />;
const SheetDescription = D.Description;

function SheetContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <D.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l bg-card shadow-xl sm:max-w-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close className="absolute top-3 right-3 rounded-sm p-1 text-muted-foreground opacity-70 hover:bg-accent hover:opacity-100" aria-label="Close">
          <XIcon className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export { Sheet, SheetContent, SheetDescription, SheetTitle };
