import test from "node:test";
import assert from "node:assert/strict";
import {
  entityHealth,
  bookmarks,
  indexedEvents,
  lifecycleRows,
} from "../src/insights.js";
import { generateSession, validateFrame } from "../src/model.js";
test("health separates connection, staleness and entity states", () => {
  const context = {
    live: true,
    connected: true,
    lastReceived: 1000,
    now: 1100,
    frameTime: 5,
  };
  assert.equal(entityHealth({ state: "RUNNING" }, context).state, "HEALTHY");
  assert.equal(entityHealth({ state: "IDLE" }, context).state, "IDLE");
  assert.equal(entityHealth({ state: "DEGRADED" }, context).state, "DEGRADED");
  assert.equal(entityHealth({ state: "OFFLINE" }, context).state, "OFFLINE");
  assert.equal(
    entityHealth({ state: "RUNNING" }, { ...context, connected: false }).state,
    "DISCONNECTED",
  );
  assert.equal(
    entityHealth({ state: "RUNNING" }, { ...context, lastReceived: 0 }).state,
    "WAITING",
  );
  assert.equal(
    entityHealth({ state: "RUNNING" }, { ...context, now: 4000 }).state,
    "STALE",
  );
  assert.equal(
    entityHealth({ state: "RUNNING", updatedAt: 1 }, context).state,
    "STALE",
  );
});
test("paused recordings do not age with wall-clock time", () => {
  assert.equal(
    entityHealth(
      { state: "HEALTHY" },
      { live: false, now: 999999, frameTime: 10 },
    ).state,
    "HEALTHY",
  );
});
test("bookmarks contain gaps, rejection, warning and largest fill", () => {
  const rows = indexedEvents(generateSession(42, 200).frames);
  rows.push({
    id: "warning",
    type: "RISK_WARNING",
    frameTime: 4,
    time: 4,
    message: "Position approaching limit",
  });
  const marks = bookmarks(rows);
  assert.ok(marks.some((x) => x.type === "FEED_GAP"));
  assert.ok(marks.some((x) => x.type === "RISK_REJECTED"));
  assert.ok(marks.some((x) => x.id === "warning"));
  const max = Math.max(
    ...rows.filter((x) => x.type === "FILL").map((x) => x.qty),
  );
  assert.equal(marks.find((x) => x.label.startsWith("LARGEST")).qty, max);
});
test("lifecycle sorting and deltas use timestamps, deduplicate IDs, and never invent stages", () => {
  const events = [
    { id: "2", orderId: "A", type: "FILL", time: 1.0002 },
    { id: "1", orderId: "A", type: "ORDER_SENT", time: 1 },
    { id: "2", orderId: "A", type: "FILL", time: 1.0002 },
    { id: "3", orderId: "B", type: "ORDER_ACK", time: 1 },
  ];
  const rows = lifecycleRows(events, "A");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, "ORDER_SENT");
  assert.ok(Math.abs(rows[1].deltaUs - 200) < 1e-6);
  assert.equal(rows[0].deltaUs, null);
});
test("entity freshness and risk-warning protocol validate without an order", () => {
  const f = generateSession(1, 5).frames.at(-1);
  f.strategies[0].updatedAt = 2;
  f.events = [
    {
      id: "warn",
      type: "RISK_WARNING",
      strategyId: "mm",
      time: 5,
      message: "Position approaching limit",
    },
  ];
  validateFrame(f);
  f.strategies[0].updatedAt = 6;
  assert.throws(() => validateFrame(f));
});
