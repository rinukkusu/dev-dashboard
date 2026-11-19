import { ExternalLinkIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";

type View = { s: number; x: number; y: number };
type Point = { x: number; y: number };

const MAX = 8;
const DOUBLE_TAP_MS = 300;

/**
 * A picture full screen, in the app: two fingers zoom and move it, one finger moves it once zoomed,
 * a double tap zooms in on that spot (and out again). Back – the phone's button too – closes it,
 * the icon opens the file itself in the browser.
 */
export function ImageViewer({ src, name, href, onClose }: { src: string; name: string; href: string; onClose: () => void }) {
  const t = useT();
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  /** where the gesture started: the view then, and the finger(s) */
  const start = useRef<{ view: View; mid: Point; dist: number; moved: boolean } | undefined>(undefined);
  const lastTap = useRef(0);

  // the phone's back button closes the picture, not the chat: an entry of its own in the history
  useEffect(() => {
    history.pushState({ viewer: true }, "");
    const back = () => onClose();
    window.addEventListener("popstate", back);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && history.back();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("popstate", back);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  /** a finger's position relative to the middle of the screen */
  const at = (e: PointerEvent): Point => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };
  const gesture = () => {
    const ps = [...pointers.current.values()];
    const mid = { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
    const dist = ps.length > 1 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y) : 0;
    return { mid, dist };
  };
  const begin = (moved = false) => {
    const { mid, dist } = gesture();
    start.current = { view, mid, dist, moved };
  };

  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, at(e));
    begin(pointers.current.size > 1);
  };
  const move = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, at(e));
    const { mid, dist } = gesture();
    const s0 = start.current;
    if (Math.hypot(mid.x - s0.mid.x, mid.y - s0.mid.y) > 6) s0.moved = true;
    if (pointers.current.size > 1 && s0.dist > 0) {
      // the spot between the fingers stays under them: p = t + s·q
      const s = Math.min(MAX, Math.max(1, (s0.view.s * dist) / s0.dist));
      const qx = (s0.mid.x - s0.view.x) / s0.view.s;
      const qy = (s0.mid.y - s0.view.y) / s0.view.s;
      setView({ s, x: mid.x - s * qx, y: mid.y - s * qy });
    } else if (s0.view.s > 1) {
      setView({ ...s0.view, x: s0.view.x + mid.x - s0.mid.x, y: s0.view.y + mid.y - s0.mid.y });
    }
  };
  const up = (e: PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    pointers.current.delete(e.pointerId);
    const tap = pointers.current.size === 0 && !start.current?.moved;
    if (pointers.current.size) begin(true);
    else start.current = undefined;
    setView((v) => (v.s <= 1.02 ? { s: 1, x: 0, y: 0 } : v));
    if (!tap) return;
    if (e.timeStamp - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      setView((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: v.x + (p.x - v.x) * (1 - 2.5 / v.s), y: v.y + (p.y - v.y) * (1 - 2.5 / v.s) }));
    } else lastTap.current = e.timeStamp;
  };

  return createPortal(
    <div role="dialog" aria-modal aria-label={name} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <span className="min-w-0 flex-1 truncate pl-2 text-sm text-white/80">{name}</span>
        {/* in this window, in place of the viewer's history entry: back from the file is back in the chat
            (a new window would be a window of its own in the installed app, and back would close it all) */}
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            location.replace(href);
          }}
          aria-label={t.remote.files.open}
          className="rounded-full p-2.5 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <ExternalLinkIcon className="size-5" />
        </a>
        <button type="button" aria-label={t.remote.files.close} onClick={() => history.back()} className="rounded-full p-2.5 text-white/80 hover:bg-white/10 hover:text-white">
          <XIcon className="size-6" />
        </button>
      </div>
      <div
        ref={box}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => setView((v) => (v.s * Math.exp(-e.deltaY / 300) <= 1 ? { s: 1, x: 0, y: 0 } : { ...v, s: Math.min(MAX, v.s * Math.exp(-e.deltaY / 300)) }))}
        className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
      >
        <img
          src={src}
          alt={name}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain will-change-transform"
        />
      </div>
    </div>,
    document.body,
  );
}
