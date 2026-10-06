import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { WebSocket } from "ws";
import { validateFrame } from "../src/model.js";
const directory = mkdtempSync(join(tmpdir(), "nexus-cpp-"));
const app = createApp({ dataDir: directory });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${app.server.address().port}`;
let example, bridge;
try {
  const path = join(directory, "capture.ndjson");
  example = spawn(resolve("build-cpp/nexus_example"), [path], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  example.on("error", (e) => console.error(e.message));
  const completed = once(example, "exit");
  while (!existsSync(path)) await new Promise((r) => setTimeout(r, 25));
  bridge = spawn(
    "python3",
    [
      "adapters/bridge.py",
      path,
      "--session",
      "cpp-check",
      "--source",
      "example",
      "--token-file",
      app.tokenPath,
      "--url",
      url + "/api/ingest",
      "--follow",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const [code] = await completed;
  if (code !== 0) throw Error("C++ example failed");
  const expected = readFileSync(path, 'utf8').trim().split('\n').length;
  let saved = 0;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const status = await (await fetch(url + '/api/sessions')).json();
    saved = status.sessions[0]?.frame_count || 0;
    if (saved === expected) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (saved !== expected) throw Error(`Only ${saved}/${expected} frames persisted`);
  bridge.kill();
  await once(bridge, "exit");
  const data = await (await fetch(url + "/api/sessions")).json();
  const session = data.sessions[0];
  if (!session || session.frame_count < 95)
    throw Error("Incomplete end-to-end capture");
  const ws = new WebSocket(
    url.replace("http:", "ws:") + "/ws?session=cpp-check",
  );
  const [bytes] = await once(ws, "message");
  const f = validateFrame(JSON.parse(bytes));
  if (f.source !== "example" || f.strategies[0].state !== "RUNNING")
    throw Error("Wrong snapshot");
  ws.close();
  console.log(
    `C++ → growing NDJSON → Python bridge → SQLite → WebSocket: ${session.frame_count} valid frames, source=example, drops=${f.dropped}`,
  );
} finally {
  example?.kill();
  bridge?.kill();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
