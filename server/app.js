import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  createReadStream,
} from "node:fs";
import { resolve, extname, sep } from "node:path";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { validateFrame } from "../src/model.js";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_BODY = 128 * 1024;
const stable = (value) =>
  JSON.stringify(value, function (key, item) {
    return item && typeof item === "object" && !Array.isArray(item)
      ? Object.keys(item)
          .sort()
          .reduce((out, k) => ((out[k] = item[k]), out), {})
      : item;
  });
export function createApp({
  dataDir,
  distDir,
  token,
  maxBytes = 2 * 1024 ** 3,
} = {}) {
  dataDir = resolve(dataDir || "data");
  distDir = resolve(distDir || "dist");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tokenPath = resolve(dataDir, "ingest-token");
  if (!token) {
    if (!existsSync(tokenPath))
      writeFileSync(tokenPath, randomBytes(32).toString("hex"), {
        mode: 0o600,
        flag: "wx",
      });
    token = readFileSync(tokenPath, "utf8").trim();
  }
  if (token.length < 24)
    throw Error("Ingestion token must be at least 24 characters");
  const db = new DatabaseSync(resolve(dataDir, "sessions.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, label TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS frames (session_id TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL, time REAL NOT NULL, json TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(session_id,seq));
    CREATE INDEX IF NOT EXISTS frames_time ON frames(session_id,time);
    CREATE TABLE IF NOT EXISTS events(session_id TEXT NOT NULL, seq INTEGER NOT NULL, frame_time REAL NOT NULL, event_id TEXT NOT NULL, type TEXT NOT NULL, order_id TEXT, qty REAL, json TEXT NOT NULL, PRIMARY KEY(session_id,seq,event_id));
    CREATE INDEX IF NOT EXISTS events_order ON events(session_id,order_id);
    CREATE INDEX IF NOT EXISTS events_type ON events(session_id,type);
`);
  if (db.prepare("PRAGMA user_version").get().user_version < 1) {
    db.exec(
      "BEGIN IMMEDIATE; INSERT OR IGNORE INTO events SELECT f.session_id,f.seq,f.time,json_extract(e.value,'$.id'),json_extract(e.value,'$.type'),json_extract(e.value,'$.orderId'),json_extract(e.value,'$.qty'),e.value FROM frames f,json_each(f.json,'$.events') e; PRAGMA user_version=1; COMMIT;",
    );
  }
  const latest = db.prepare(
    "SELECT seq,time,json,hash FROM frames WHERE session_id=? ORDER BY seq DESC LIMIT 1",
  );
  const existing = db.prepare(
    "SELECT hash FROM frames WHERE session_id=? AND seq=?",
  );
  const sessionInfo = db.prepare("SELECT * FROM sessions WHERE id=?");
  const list =
    db.prepare(`SELECT s.*, COUNT(f.seq) AS frame_count, MIN(f.time) AS start_time, MAX(f.time) AS end_time
    FROM sessions s LEFT JOIN frames f ON f.session_id=s.id GROUP BY s.id ORDER BY s.updated DESC LIMIT 200`);
  const insert = db.prepare("INSERT INTO frames VALUES (?,?,?,?,?)");
  const seekFrame = db.prepare(
    "SELECT seq FROM frames WHERE session_id=? AND time<=? ORDER BY time DESC LIMIT 1",
  );
  const page = db.prepare(
    "SELECT json FROM frames WHERE session_id=? AND seq>? ORDER BY seq LIMIT ?",
  );
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let closing = false,
    accepted = 0,
    rejected = 0;
  const originsFor = (req) => {
    const port = server.address()?.port;
    return [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ];
  };
  const validHost = (req) => {
    const port = server.address()?.port;
    return [`127.0.0.1:${port}`, `localhost:${port}`].includes(
      req.headers.host,
    );
  };
  const validOrigin = (req) =>
    !req.headers.origin || originsFor(req).includes(req.headers.origin);
  function json(res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }
  function authorized(req) {
    const actual = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${token}`);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
  function broadcast(id, serialized) {
    for (const ws of wsServer.clients)
      if (ws.sessionId === id && ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 256 * 1024) ws.close(1013, "Slow consumer");
        else ws.send(serialized);
      }
  }
  function ingest(body) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw Object.assign(Error("Expected an ingestion object"), {
        status: 400,
      });
    const { sessionId, frame, source = "telemetry", label = sessionId } = body;
    if (
      !ID.test(sessionId || "") ||
      !["telemetry", "example", "demo"].includes(source) ||
      typeof label !== "string" ||
      label.length > 120
    )
      throw Object.assign(Error("Invalid session metadata"), { status: 400 });
    try {
      validateFrame(frame);
    } catch (error) {
      error.status = 400;
      throw error;
    }
    if (frame.source && frame.source !== source)
      throw Object.assign(Error("Frame source does not match session source"), {
        status: 400,
      });
    frame.source = source;
    const serialized = stable(frame),
      hash = createHash("sha256").update(serialized).digest("hex");
    const duplicate = existing.get(sessionId, frame.seq);
    if (duplicate) {
      if (duplicate.hash !== hash)
        throw Object.assign(
          Error("Sequence already contains a different frame"),
          { status: 409 },
        );
      return { duplicate: true, sessionId, seq: frame.seq };
    }
    const previous = latest.get(sessionId);
    if (previous && (frame.seq <= previous.seq || frame.time <= previous.time))
      throw Object.assign(Error("Sequence and time must increase"), {
        status: 409,
      });
    const info = sessionInfo.get(sessionId);
    if (info && (info.source !== source || info.label !== label))
      throw Object.assign(
        Error("Session metadata is immutable; use a new session ID"),
        { status: 409 },
      );
    const storageBytes = ["sessions.sqlite", "sessions.sqlite-wal"].reduce(
      (n, name) => {
        const path = resolve(dataDir, name);
        return n + (existsSync(path) ? statSync(path).size : 0);
      },
      0,
    );
    if (storageBytes >= maxBytes)
      throw Object.assign(
        Error("Storage quota reached; archive data before continuing"),
        { status: 507 },
      );
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT OR IGNORE INTO sessions VALUES (?,?,?,?,?)").run(
        sessionId,
        source,
        label,
        now,
        now,
      );
      insert.run(sessionId, frame.seq, frame.time, serialized, hash);
      for (const e of frame.events)
        db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?,?)").run(
          sessionId,
          frame.seq,
          frame.time,
          e.id,
          e.type,
          e.orderId ?? null,
          e.qty ?? null,
          JSON.stringify(e),
        );
      db.prepare("UPDATE sessions SET updated=? WHERE id=?").run(
        now,
        sessionId,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    accepted++;
    broadcast(sessionId, serialized);
    return { duplicate: false, sessionId, seq: frame.seq };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!validHost(req) || !validOrigin(req))
      return json(res, 403, { error: "Untrusted host or origin" });
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/healthz")
        return json(res, 200, {
          status: closing ? "closing" : "ok",
          accepted,
          rejected,
          clients: wsServer.clients.size,
        });
      if (req.method === "GET" && url.pathname === "/api/sessions")
        return json(res, 200, { sessions: list.all() });
      const eventMatch = url.pathname.match(
        /^\/api\/sessions\/([a-zA-Z0-9_-]+)\/(bookmarks|orders)$/,
      );
      if (req.method === "GET" && eventMatch) {
        const id = eventMatch[1];
        if (!sessionInfo.get(id))
          return json(res, 404, { error: "Session not found" });
        const decode = (row) => ({
          ...JSON.parse(row.json),
          frameTime: row.frame_time,
          seq: row.seq,
        });
        if (eventMatch[2] === "orders") {
          const orderId = url.searchParams.get("id");
          if (!orderId || orderId.length > 120)
            return json(res, 400, { error: "Order ID required" });
          const rows = db
            .prepare(
              "SELECT * FROM events WHERE session_id=? AND order_id=? ORDER BY frame_time,seq LIMIT 2000",
            )
            .all(id, orderId);
          return json(res, 200, { events: rows.map(decode) });
        }
        const after = Number(url.searchParams.get("after") ?? -1);
        if (!Number.isSafeInteger(after))
          return json(res, 400, { error: "Invalid bookmark cursor" });
        const rows = db
          .prepare(
            "SELECT rowid AS cursor,* FROM events WHERE session_id=? AND rowid>? AND type IN ('FEED_GAP','FEED_RECOVERED','RISK_REJECTED','RISK_WARNING','RISK_LIMIT_BREACHED') ORDER BY rowid LIMIT 500",
          )
          .all(id, after);
        const largest = db
          .prepare(
            "SELECT * FROM events WHERE session_id=? AND type='FILL' ORDER BY qty DESC,frame_time LIMIT 1",
          )
          .get(id);
        return json(res, 200, {
          events: rows.map(decode),
          next: rows.at(-1)?.cursor ?? after,
          hasMore: rows.length === 500,
          largest: largest ? decode(largest) : null,
        });
      }
      const exportMatch = url.pathname.match(
        /^\/api\/sessions\/([a-zA-Z0-9_-]+)\/export$/,
      );
      if (req.method === "GET" && exportMatch) {
        const id = exportMatch[1];
        if (!sessionInfo.get(id))
          return json(res, 404, { error: "Session not found" });
        const last = latest.get(id).seq;
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": `attachment; filename="${id}.ndjson"`,
        });
        let cursor = -1;
        while (!res.destroyed) {
          const rows = page.all(id, cursor, 500);
          if (!rows.length) break;
          for (const row of rows) {
            const f = JSON.parse(row.json);
            if (f.seq > last) {
              res.end();
              return;
            }
            cursor = f.seq;
            if (!res.write(row.json + "\n")) {
              await new Promise((resolve) => {
                const done = () => {
                  res.off("drain", done);
                  res.off("close", done);
                  resolve();
                };
                res.once("drain", done);
                res.once("close", done);
              });
            }
            if (res.destroyed) break;
          }
          if (cursor >= last) break;
        }
        res.end();
        return;
      }
      const match = url.pathname.match(
        /^\/api\/sessions\/([a-zA-Z0-9_-]+)\/frames$/,
      );
      if (req.method === "GET" && match) {
        const info = sessionInfo.get(match[1]);
        if (!info) return json(res, 404, { error: "Session not found" });
        let after = Number(url.searchParams.get("after") ?? -1);
        if (url.searchParams.has("at")) {
          const at = Number(url.searchParams.get("at"));
          if (!Number.isFinite(at) || at < 0)
            return json(res, 400, { error: "Invalid seek time" });
          after = (seekFrame.get(match[1], at)?.seq ?? 0) - 1;
        }
        const limit = Number(url.searchParams.get("limit") ?? 500);
        if (
          !Number.isSafeInteger(after) ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 1000
        )
          return json(res, 400, { error: "Invalid pagination" });
        const frames = page
          .all(match[1], after, limit)
          .map((row) => JSON.parse(row.json));
        return json(res, 200, {
          session: info,
          frames,
          next: frames.at(-1)?.seq ?? after,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/ingest") {
        if (!authorized(req))
          return json(res, 401, { error: "Bearer ingestion token required" });
        if (Number(req.headers["content-length"]) > MAX_BODY) {
          req.resume();
          return json(res, 413, { error: "Frame exceeds 128 KiB" });
        }
        let bytes = 0,
          tooLarge = false;
        const chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX_BODY) {
            tooLarge = true;
            chunks.length = 0;
          }
          if (!tooLarge) chunks.push(chunk);
        }
        if (tooLarge) return json(res, 413, { error: "Frame exceeds 128 KiB" });
        try {
          let body;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch (error) {
            error.status = 400;
            throw error;
          }
          return json(res, 200, ingest(body));
        } catch (error) {
          rejected++;
          return json(res, error.status || 500, {
            error: error.status
              ? error.message
              : "Persistence failed; frame was not accepted",
          });
        }
      }
      if (url.pathname.startsWith("/api/"))
        return json(res, 404, { error: "Unknown API route" });
      if (req.method !== "GET" && req.method !== "HEAD")
        return json(res, 405, { error: "Method not allowed" });
      const relative =
        decodeURIComponent(url.pathname) === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1);
      const path = resolve(distDir, relative);
      if (
        !path.startsWith(distDir + sep) ||
        !existsSync(path) ||
        !statSync(path).isFile()
      )
        return json(res, 404, { error: "Asset not found; run npm run build" });
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, {
        "Content-Type": types[extname(path)] || "application/octet-stream",
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(path)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: "Internal server error" });
      else res.destroy();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost"),
      id = url.searchParams.get("session");
    if (
      closing ||
      !validHost(req) ||
      !validOrigin(req) ||
      url.pathname !== "/ws" ||
      !ID.test(id || "") ||
      !sessionInfo.get(id) ||
      wsServer.clients.size >= 32
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      ws.sessionId = id;
      ws.alive = true;
      ws.on("pong", () => (ws.alive = true));
      ws.on("error", () => {});
      ws.on("message", () => ws.close(1008, "Read-only connection"));
      ws.send(latest.get(id).json);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wsServer.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 15000).unref();
  return {
    server,
    dataDir,
    tokenPath,
    async close() {
      closing = true;
      clearInterval(heartbeat);
      for (const ws of wsServer.clients) ws.terminate();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeIdleConnections();
      });
      wsServer.close();
      db.close();
    },
  };
}
