// Makes herdr's socket reachable over TCP, for a dashboard in Docker that can't open it directly –
// mainly herdr on Windows, whose named pipe a Linux container can't see.
//   bun run herdr-bridge              → 127.0.0.1:7377, socket from HERDR_BRIDGE_SOCKET or `herdr status server`
// In .env for Docker: HERDR_SOCKET=tcp://host.docker.internal:7377
//
// Anyone who can reach this port can type into your agents' terminals. It only listens on
// 127.0.0.1, so that's processes on this machine – keep it that way.
import { createConnection, createServer } from "node:net";
import { socketPath } from "./herdr.ts";

const port = Number(Bun.env.HERDR_BRIDGE_PORT) || 7377;

/** Asks the herdr CLI where its server listens. */
async function socketFromCli(): Promise<string> {
  const proc = Bun.spawn(["herdr", "status", "server"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const path = out.match(/^socket:\s*(.+)$/m)?.[1]?.trim();
  if (!path) throw new Error(`"herdr status server" didn't print a socket – is herdr running?\n${out}`);
  return path;
}

// on Windows the printed path is turned into its named pipe, see socketPath()
const target = socketPath(Bun.env.HERDR_BRIDGE_SOCKET?.trim() || (await socketFromCli()));

const server = createServer((client) => {
  const upstream = createConnection({ path: target });
  client.pipe(upstream).pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", (e) => {
    console.error(`herdr-bridge: ${e.message}`);
    close();
  });
});

server.listen(port, "127.0.0.1", () => console.log(`herdr-bridge: 127.0.0.1:${port} → ${target}`));
