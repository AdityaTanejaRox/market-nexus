import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { generateSession } from "../src/model.js";
const token = "test-token-012345678901234567890";
async function start(directory) {
  const app = createApp({ dataDir: directory, token });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  return { app, url: `http://127.0.0.1:${app.server.address().port}` };
}
async function post(url, frame, extra = {}) {
  return fetch(url + "/api/ingest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "test-session",
      label: "Integration test",
      source: "demo",
      frame,
      ...extra,
    }),
  });
}
test("authenticated ingestion, replay, idempotency and restart recovery", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nexus-"));
  let running;
  try {
    running = await start(directory);
    const { frames } = generateSession(1, 4);
    const denied = await fetch(running.url + "/api/ingest", {
      method: "POST",
      body: "{}",
    });
    assert.equal(denied.status, 401);
    const oversized = await fetch(running.url + "/api/ingest", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "x".repeat(150000),
    });
    assert.equal(oversized.status, 413);
    const nullBody = await fetch(running.url + "/api/ingest", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "null",
    });
    assert.equal(nullBody.status, 400);
    assert.equal((await post(running.url, frames[0])).status, 200);
    assert.equal(
      (await (await post(running.url, frames[0])).json()).duplicate,
      true,
    );
    const changed = structuredClone(frames[0]);
    changed.strategies[0].pnl++;
    assert.equal((await post(running.url, changed)).status, 409);
    const socket = new WebSocket(
      running.url.replace("http:", "ws:") + "/ws?session=test-session",
    );
    const [initial] = await once(socket, "message");
    assert.equal(JSON.parse(initial).seq, frames[0].seq);
    const next = once(socket, "message");
    assert.equal((await post(running.url, frames[1])).status, 200);
    assert.equal(JSON.parse((await next)[0]).seq, frames[1].seq);
    socket.close();
    for (const frame of frames.slice(2))
      assert.equal((await post(running.url, frame)).status, 200);
    assert.equal(
      (await post(running.url, { ...frames[4], seq: 100, time: 1 })).status,
      409,
    );
    const page = await (
      await fetch(
        running.url + "/api/sessions/test-session/frames?at=2.5&limit=2",
      )
    ).json();
    assert.deepEqual(
      page.frames.map((f) => f.time),
      [2, 3],
    );
    const exported = await (
      await fetch(running.url + "/api/sessions/test-session/export")
    ).text();
    assert.equal(exported.trim().split("\n").length, 5);
    assert.equal(
      (
        await fetch(running.url + "/api/sessions", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const hostStatus = await new Promise((resolve, reject) => {
      http
        .get(
          running.url + "/api/sessions",
          { headers: { Host: "evil.example" } },
          (r) => {
            r.resume();
            resolve(r.statusCode);
          },
        )
        .on("error", reject);
    });
    assert.equal(hostStatus, 403);
    await running.app.close();
    running = await start(directory);
    const list = await (await fetch(running.url + "/api/sessions")).json();
    assert.equal(list.sessions[0].frame_count, 5);
    const ws = new WebSocket(
      running.url.replace("http:", "ws:") + "/ws?session=test-session",
    );
    const [snapshot] = await once(ws, "message");
    assert.equal(JSON.parse(snapshot).seq, 5);
    ws.close();
    const bad = structuredClone(frames[0]);
    bad.events = [
      {
        id: "x",
        type: "FILL",
        strategyId: "mm",
        time: 1,
        orderId: "1",
        side: "BUY",
        qty: -1,
        price: 2,
      },
    ];
    assert.equal(
      (await post(running.url, bad, { sessionId: "invalid" })).status,
      400,
    );
  } finally {
    if (running) await running.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("bounded storage rejects new data without overwriting stored state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nexus-quota-"));
  const app = createApp({ dataDir: directory, token, maxBytes: 1 });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  try {
    assert.equal(
      (
        await post(
          `http://127.0.0.1:${app.server.address().port}`,
          generateSession(1, 0).frames[0],
        )
      ).status,
      507,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
