// Who may use the remote control (remote.ts): paired devices and the networks they may come from.
// Pairing: the dashboard on localhost makes a one-time code and shows it as a QR code; the phone
// opens <remote>/pair#<code>, trades the code for a device token and keeps that as a cookie.
// Only the tokens' hashes are stored, so the file is no key to your agents.
import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { readJson, writeAtomic } from "./store.ts";

export type Device = {
  id: string;
  /** from the phone's browser, e.g. "iPhone · Safari" */
  name: string;
  createdAt: string;
  lastSeen: string;
  /** sha256 of the token, hex */
  tokenHash: string;
};

/** A code is good for this long and for one device. */
export const PAIR_TTL_MS = 10 * 60_000;
/** lastSeen is written at most this often – it's only for the device list */
const SEEN_EVERY_MS = 60 * 60_000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export type Pairing = { code: string; expiresAt: number };

export type Devices = {
  list(): Device[];
  /** a new code; it replaces the one before */
  newCode(now?: number): Pairing;
  /** the code (once) for a new device: its token, or undefined */
  redeem(code: string, name: string, now?: number): Promise<{ token: string; device: Device } | undefined>;
  /** the device the token belongs to */
  check(token: string | undefined, now?: number): Device | undefined;
  revoke(id: string): Promise<boolean>;
  /** the open code is used up as soon as someone paired with it */
  pending(now?: number): Pairing | undefined;
};

export async function loadDevices(path: string): Promise<Devices> {
  const devices: Device[] = (await readJson<Device[]>(path)) ?? [];
  let code: Pairing | undefined;
  // one write at a time: two at once would share writeAtomic's temp file
  let writing: Promise<void> = Promise.resolve();
  const save = () =>
    (writing = writing.catch(() => {}).then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeAtomic(path, JSON.stringify(devices, null, 2));
    }));
  return {
    list: () => devices,
    newCode(now = Date.now()) {
      code = { code: randomBytes(18).toString("base64url"), expiresAt: now + PAIR_TTL_MS };
      return code;
    },
    pending: (now = Date.now()) => (code && code.expiresAt > now ? code : undefined),
    async redeem(given, name, now = Date.now()) {
      if (!code || code.expiresAt <= now || given !== code.code) return undefined;
      code = undefined;
      const token = randomBytes(32).toString("base64url");
      const at = new Date(now).toISOString();
      const device: Device = { id: randomBytes(6).toString("hex"), name: name.trim().slice(0, 80) || "?", createdAt: at, lastSeen: at, tokenHash: hash(token) };
      devices.push(device);
      await save();
      return { token, device };
    },
    check(token, now = Date.now()) {
      if (!token) return undefined;
      const h = hash(token);
      const device = devices.find((d) => d.tokenHash === h);
      if (device && now - Date.parse(device.lastSeen) > SEEN_EVERY_MS) {
        device.lastSeen = new Date(now).toISOString();
        void save().catch(() => {});
      }
      return device;
    },
    async revoke(id) {
      const i = devices.findIndex((d) => d.id === id);
      if (i < 0) return false;
      devices.splice(i, 1);
      await save();
      return true;
    },
  };
}

// --- networks ---------------------------------------------------------------------------

/** "192.168.0.0/24" → [network, mask] as 32-bit numbers; only IPv4 ranges. */
function parseCidr(cidr: string): [number, number] | undefined {
  const m = cidr.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/);
  const ip = m ? ipv4(m[1]!) : undefined;
  if (!m || ip === undefined) return undefined;
  const bits = m[2] === undefined ? 32 : Number(m[2]);
  if (bits > 32) return undefined;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return [(ip & mask) >>> 0, mask];
}

function ipv4(s: string): number | undefined {
  const parts = s.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return undefined;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export const isCidr = (s: string) => parseCidr(s) !== undefined;

/**
 * May a request from this address use the remote control? This machine always may (a proxy in
 * front, e.g. `tailscale serve`, connects from there); others only from the listed IPv4 ranges.
 */
export function allowedFrom(address: string | undefined, allow: string[]): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/i, "");
  if (a === "::1") return true;
  const ip = ipv4(a);
  if (ip === undefined) return false; // other IPv6: not supported
  if (ip >>> 24 === 127) return true;
  return allow.some((c) => {
    const r = parseCidr(c);
    return !!r && ((ip & r[1]) >>> 0) === r[0];
  });
}
