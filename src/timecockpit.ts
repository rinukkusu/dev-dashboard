import type { TimecockpitConfig } from "./config.ts";
import { getJson } from "./http.ts";

// time cockpit OData API. Not a source of its own: it adds booked hours to the Jira tickets.
// The PAT decides whose timesheets come back – a normal user token only sees your own.

type RawTimesheet = { APP_DurationInHours: number | string | null; APP_Task?: { APP_Code: string } | null };

/** Keys per request, so the $filter stays a reasonable URL length. */
const KEYS_PER_REQUEST = 40;
const PAGE_SIZE = 500;

/** OData wants %20, not the "+" URLSearchParams writes for spaces. */
const query = (params: Record<string, string>) =>
  Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/** Hours booked on the tasks with these codes (= Jira keys). Keys without bookings are missing from the map. */
export async function bookedHours(cfg: TimecockpitConfig, keys: string[]): Promise<Map<string, number>> {
  const headers = { Authorization: `Bearer ${cfg.pat}` };
  const hours = new Map<string, number>();
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += KEYS_PER_REQUEST) {
    const filter = unique
      .slice(i, i + KEYS_PER_REQUEST)
      .map((k) => `APP_Task/APP_Code eq '${k.replace(/'/g, "''")}'`)
      .join(" or ");
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const q = query({
        $filter: filter,
        $expand: "APP_Task",
        $select: "APP_DurationInHours,APP_Task/APP_Code",
        $top: String(PAGE_SIZE),
        $skip: String(skip),
      });
      const page = await getJson<{ value: RawTimesheet[] }>(`${cfg.apiUrl}/APP_Timesheet?${q}`, headers);
      for (const r of page.value) {
        const code = r.APP_Task?.APP_Code;
        if (code) hours.set(code, (hours.get(code) ?? 0) + Number(r.APP_DurationInHours ?? 0));
      }
      if (page.value.length < PAGE_SIZE) break;
    }
  }
  return hours;
}
