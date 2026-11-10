import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const field = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50";

export const Input = ({ className, ...props }: ComponentProps<"input">) => <input className={cn(field, "h-8", className)} {...props} />;
export const Textarea = ({ className, ...props }: ComponentProps<"textarea">) => <textarea className={cn(field, "min-h-16 resize-y", className)} {...props} />;
export const Select = ({ className, ...props }: ComponentProps<"select">) => <select className={cn(field, "h-8 py-0", className)} {...props} />;
export const Label = ({ className, ...props }: ComponentProps<"label">) => <label className={cn("grid gap-1.5 text-sm font-medium", className)} {...props} />;
