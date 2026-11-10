import { XIcon } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const Dialog = D.Root;
const DialogTrigger = D.Trigger;
const DialogClose = D.Close;

function DialogOverlay({ className, ...props }: ComponentProps<typeof D.Overlay>) {
  return <D.Overlay className={cn("fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0", className)} {...props} />;
}

function DialogContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <DialogOverlay />
      <D.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-card p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
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

const DialogHeader = ({ className, ...props }: ComponentProps<"div">) => <div className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />;
const DialogTitle = ({ className, ...props }: ComponentProps<typeof D.Title>) => <D.Title className={cn("text-base leading-tight font-semibold", className)} {...props} />;
const DialogDescription = ({ className, ...props }: ComponentProps<typeof D.Description>) => <D.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
const DialogFooter = ({ className, ...props }: ComponentProps<"div">) => <div className={cn("flex items-center justify-end gap-2", className)} {...props} />;

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger };
