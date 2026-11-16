import type { TimecockpitConfig } from "./config.ts";
import { getJson } from "./http.ts";
import type { Timesheet } from "./model.ts";

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

type RawSheet = {
  APP_TimesheetUuid: string;
  APP_BeginTime: string;
  APP_EndTime: string;
  APP_DurationInHours: number | string | null;
  APP_Description: string | null;
  APP_Project?: { APP_Code: string } | null;
  APP_Task?: { APP_Code: string } | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The bookings from `from` to `to` (both YYYY-MM-DD, inclusive), oldest first. */
export async function timesheets(cfg: TimecockpitConfig, from: string, to: string): Promise<Timesheet[]> {
  if (!DAY.test(from) || !DAY.test(to)) throw new Error("dates must be YYYY-MM-DD");
  const headers = { Authorization: `Bearer ${cfg.pat}` };
  const out: Timesheet[] = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const q = query({
      $filter: `APP_BeginTime ge datetime'${from}T00:00:00' and APP_BeginTime lt datetime'${nextDay(to)}T00:00:00'`,
      $expand: "APP_Project,APP_Task",
      $select: "APP_TimesheetUuid,APP_BeginTime,APP_EndTime,APP_DurationInHours,APP_Description,APP_Project/APP_Code,APP_Task/APP_Code",
      $orderby: "APP_BeginTime",
      $top: String(PAGE_SIZE),
      $skip: String(skip),
    });
    const page = await getJson<{ value: RawSheet[] }>(`${cfg.apiUrl}/APP_Timesheet?${q}`, headers);
    for (const r of page.value) {
      out.push({
        id: r.APP_TimesheetUuid,
        begin: r.APP_BeginTime.slice(0, 19),
        end: r.APP_EndTime.slice(0, 19),
        // time cockpit stores 0.4999999999999992 for half an hour
        hours: Math.round(Number(r.APP_DurationInHours ?? 0) * 100) / 100,
        project: r.APP_Project?.APP_Code ?? "",
        task: r.APP_Task?.APP_Code || undefined,
        description: r.APP_Description ?? "",
      });
    }
    if (page.value.length < PAGE_SIZE) break;
  }
  return out;
}
