import { cn } from "@/lib/utils";

// Marks of the sources. The source is the prefix of a resource id ("jira:KEY", "ado:pr:1", …);
// GitHub Enterprise shares the GitHub mark, herdr spaces get none.
const LOGOS: Record<string, { label: string; className: string; viewBox: string; path: string }> = {
  jira: { label: "Jira", className: "text-[#2684ff]", viewBox: "0 0 24 24", path: "M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z" },
  ado: { label: "Azure DevOps", className: "text-[#0078d7]", viewBox: "0 0 24 24", path: "M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.45v14.651l-5.753 4.9-9.303-3.057v3.056l-5.978-7.416 15.057 1.798V5.415z" },
  github: { label: "GitHub", className: "text-foreground", viewBox: "0 0 16 16", path: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" },
  gitlab: { label: "GitLab", className: "text-[#fc6d26]", viewBox: "0 0 24 24", path: "M12 22.5 16.4 9H7.6zM12 22.5 7.6 9H1.4zM1.4 9 .1 13.1a.9.9 0 0 0 .3 1L12 22.5zM1.4 9h6.2L4.9.8a.5.5 0 0 0-.9 0zM12 22.5 16.4 9h6.2zM22.6 9l1.3 4.1a.9.9 0 0 1-.3 1L12 22.5zM22.6 9h-6.2L19.1.8a.5.5 0 0 1 .9 0z" },
};

export const sourceOf = (resource: string) => {
  const s = resource.split(":")[0]!;
  return s === "ghe" ? "github" : s;
};

export function SourceIcon({ resource, className }: { resource: string; className?: string }) {
  const logo = LOGOS[sourceOf(resource)];
  if (!logo) return <span className={cn("inline-block size-4 shrink-0", className)} />;
  return (
    <svg viewBox={logo.viewBox} role="img" aria-label={logo.label} className={cn("size-4 shrink-0 fill-current", logo.className, className)}>
      <title>{logo.label}</title>
      <path d={logo.path} />
    </svg>
  );
}
