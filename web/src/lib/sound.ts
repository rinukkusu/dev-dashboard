import { create } from "zustand";
import { KEYS, storage } from "./storage.ts";

// The chime for new changes. Browsers only allow audio after a click or key press on the page, so
// until then `ready` is false and the setting says "click to enable".
let ctx: AudioContext | undefined;

type Sound = { on: boolean; ready: boolean; toggle(): void };

export const useSound = create<Sound>((set, get) => ({
  on: storage.get(KEYS.sound) !== "off",
  ready: false,
  toggle() {
    const on = !get().on;
    storage.set(KEYS.sound, on ? "on" : "off");
    set({ on });
    if (on) void unlock().then(chime); // a short preview, so you know what it sounds like
  },
}));

async function unlock() {
  if (!useSound.getState().on) return;
  if (!ctx) {
    ctx = new AudioContext();
    ctx.onstatechange = () => useSound.setState({ ready: ctx?.state === "running" });
  }
  if (ctx.state !== "running") await ctx.resume().catch(() => {});
  useSound.setState({ ready: ctx.state === "running" });
}

for (const event of ["pointerdown", "keydown"]) document.addEventListener(event, () => void unlock());

/** Two short sine tones. */
export function chime() {
  if (!useSound.getState().on || !ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  for (const [freq, delay] of [
    [880, 0],
    [1318.5, 0.13],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + delay);
    gain.gain.exponentialRampToValueAtTime(0.25, t + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + delay);
    osc.stop(t + delay + 0.65);
  }
}
