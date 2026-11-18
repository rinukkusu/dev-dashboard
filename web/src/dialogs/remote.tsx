import { ShieldCheckIcon, SmartphoneIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { encode } from "uqr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ago, useT } from "@/lib/i18n";
import { api } from "@/lib/store";
import { useUi } from "@/lib/ui";

type Device = { id: string; name: string; createdAt: string; lastSeen: string };
type RemoteInfo = { urls: string[]; devices: Device[]; pending?: number; ca?: { urls: string[]; fingerprint: string } };

/**
 * Pairing phones with the remote control (src/remote.ts): a one-time code as a QR code, and the
 * devices paired so far, each of which can be removed again.
 */
export function RemoteDialog() {
  const t = useT();
  const open = useUi((s) => s.remote);
  const setUi = useUi((s) => s.set);
  return (
    <Dialog open={open} onOpenChange={(o) => setUi({ remote: o })}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.remote.title}</DialogTitle>
          <DialogDescription>{t.remote.intro}</DialogDescription>
        </DialogHeader>
        {open && <RemoteBody />}
      </DialogContent>
    </Dialog>
  );
}

function RemoteBody() {
  const t = useT();
  /** undefined = loading, null = REMOTE_PORT isn't set */
  const [info, setInfo] = useState<RemoteInfo | null>();
  const [code, setCode] = useState<{ links: string[]; expiresAt: number }>();
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string>();
  /** REMOTE_TLS=auto: the CA's QR code instead of the pairing one */
  const [showCa, setShowCa] = useState(false);

  // while the dialog is open: who's paired, and whether the code shown has been used
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<RemoteInfo>("GET", "/api/remote").then(
        (r) => !stopped && setInfo(r),
        (e) => !stopped && (e?.error === "not-configured" ? setInfo(null) : setError(t.client.agentErrors.failed)),
      );
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [t]);

  const pair = () => {
    setError(undefined);
    api<{ links: string[]; expiresAt: number }>("POST", "/api/remote/pair", {}).then(setCode, () => setError(t.client.agentErrors.failed));
  };

  if (info === undefined) return error ? <p className="text-sm text-bad">{error}</p> : null;
  if (info === null) return <p className="text-sm text-muted-foreground">{t.remote.off}</p>;

  // the code is gone from the server once a phone used it
  const used = code && !info.pending && code.expiresAt > now;
  const expired = code && code.expiresAt <= now;
  return (
    <div className="grid gap-4">
      {!info.urls.length && <p className="text-sm text-warn">{t.remote.noUrl}</p>}
      {showCa && info.ca ? (
        <div className="grid justify-items-center gap-2">
          <Qr text={info.ca.urls[0] ?? ""} />
          <p className="text-center text-sm text-muted-foreground">{t.remote.caScan}</p>
          {info.ca.urls.map((l) => (
            <code key={l} className="max-w-full rounded bg-muted px-2 py-1 font-mono text-xs break-all select-all">
              {l}
            </code>
          ))}
          <p className="text-sm text-muted-foreground">{t.remote.caFingerprint}</p>
          <code className="max-w-full rounded bg-muted px-2 py-1 text-center font-mono text-[11px] break-all select-all">{info.ca.fingerprint}</code>
          <ul className="grid gap-1 text-xs text-muted-foreground">
            <li>{t.remote.caIos}</li>
            <li>{t.remote.caAndroid}</li>
          </ul>
          <Button
            onClick={() => {
              setShowCa(false);
              pair();
            }}
            disabled={!info.urls.length}
          >
            <SmartphoneIcon /> {t.remote.pair}
          </Button>
        </div>
      ) : code && !used && !expired ? (
        <div className="grid justify-items-center gap-2">
          <Qr text={code.links[0] ?? ""} />
          <p className="text-center text-sm text-muted-foreground">
            {t.remote.scan} {t.remote.expiresIn(Math.max(1, Math.ceil((code.expiresAt - now) / 60_000)))}
          </p>
          {code.links.map((l) => (
            <code key={l} className="max-w-full rounded bg-muted px-2 py-1 font-mono text-xs break-all select-all">
              {l}
            </code>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {info.ca && (
            <Button variant="outline" onClick={() => setShowCa(true)} disabled={!info.ca.urls.length}>
              <ShieldCheckIcon /> {t.remote.caButton}
            </Button>
          )}
          <Button onClick={pair} disabled={!info.urls.length}>
            <SmartphoneIcon /> {t.remote.pair}
          </Button>
          {used && <span className="text-sm text-ok">{t.remote.paired}</span>}
          {expired && <span className="text-sm text-muted-foreground">{t.remote.expired}</span>}
        </div>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
      <div>
        <h3 className="mb-1.5 text-sm font-medium">{t.remote.devices}</h3>
        {info.devices.length ? (
          <ul className="divide-y rounded-md border">
            {info.devices.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <SmartphoneIcon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <span className="text-xs text-muted-foreground">{t.remote.seen(ago(t, d.lastSeen, now))}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.remote.revoke}
                  title={t.remote.revoke}
                  onClick={() =>
                    api("DELETE", `/api/remote/devices?id=${encodeURIComponent(d.id)}`, {}).then(
                      () => setInfo({ ...info, devices: info.devices.filter((x) => x.id !== d.id) }),
                      () => setError(t.client.agentErrors.failed),
                    )
                  }
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t.remote.noDevices}</p>
        )}
      </div>
    </div>
  );
}

/** The link as a QR code – dark on white in both themes, cameras read that best. */
function Qr({ text }: { text: string }) {
  const { size, data } = useMemo(() => encode(text, { border: 2 }), [text]);
  const path = useMemo(
    () =>
      data
        .flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : "")))
        .join(""),
    [data],
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-56 rounded-md bg-white" shapeRendering="crispEdges" role="img" aria-label={text}>
      <path d={path} fill="#000" />
    </svg>
  );
}
