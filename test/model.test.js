import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSession,
  validateSession,
  validateFrame,
  frameAt,
} from "../src/model.js";
test("demo is reproducible and validates", () => {
  assert.deepEqual(generateSession(7, 100), generateSession(7, 100));
  validateSession(generateSession());
});
test("seek returns the preceding state and clamps endpoints", () => {
  const { frames } = generateSession(1, 10);
  assert.equal(frameAt(frames, 3.9).time, 3);
  assert.equal(frameAt(frames, -1).time, 0);
  assert.equal(frameAt(frames, 100).time, 10);
});
test("reject corrupt, duplicate and unordered data", () => {
  const s = generateSession(1, 5);
  s.frames[2].time = 0;
  assert.throws(() => validateSession(s));
  const f = generateSession(1, 0).frames[0];
  f.strategies[0].pnl = Infinity;
  assert.throws(() => validateFrame(f));
});
test("filled order count agrees with the event history", () => {
  const s = generateSession(42, 200);
  const fills = s.frames
    .flatMap((f) => f.events)
    .filter((e) => e.type === "FILL");
  assert.equal(
    s.frames.at(-1).strategies.reduce((n, x) => n + x.fills, 0),
    fills.length,
  );
});
test("gap and recovery are exposed in state and events", () => {
  const s = generateSession(1, 93);
  assert.equal(s.frames[91].feeds[0].state, "DEGRADED");
  assert.equal(s.frames[92].feeds[0].state, "HEALTHY");
  assert.equal(s.frames[91].events[0].type, "FEED_GAP");
});
