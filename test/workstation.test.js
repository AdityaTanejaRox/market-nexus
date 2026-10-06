import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeWorkspace,
  pnlBounds,
  operationRows,
} from "../src/workstation.js";
import { pnlBridgePoints } from "../src/pnl-bridge.js";

test("saved preferences cannot enable invalid themes or unsafe automatic focus", () => {
  assert.equal(
    sanitizeWorkspace({ theme: "junk", autoFocus: "true" }).theme,
    "professional",
  );
  assert.equal(sanitizeWorkspace({ autoFocus: "true" }).autoFocus, false);
  assert.deepEqual(
    sanitizeWorkspace({
      theme: "showcase",
      tab: "fills",
      scale: "individual",
      autoFocus: true,
      monitors: true,
      tickerPaused: true,
    }),
    {
      theme: "showcase",
      tab: "fills",
      scale: "individual",
      autoFocus: true,
      monitors: true,
      tickerPaused: true,
    },
  );
});
test("shared bridge scale preserves relative magnitudes across strategies", () => {
  const frames = [
    {
      time: 0,
      strategies: [
        { id: "a", pnl: 0 },
        { id: "b", pnl: 0 },
      ],
    },
    {
      time: 1,
      strategies: [
        { id: "a", pnl: 100 },
        { id: "b", pnl: 10000 },
      ],
    },
  ];
  const bounds = pnlBounds(frames, "a", true);
  assert.deepEqual(bounds, { low: 0, high: 10000 });
  const a = pnlBridgePoints(frames, "a", bounds),
    b = pnlBridgePoints(frames, "b", bounds);
  assert.ok(Math.abs((a[1].y - 3.5) / (b[1].y - 3.5) - 0.01) < 1e-8);
  assert.deepEqual(pnlBounds(frames, "a", false), { low: 0, high: 100 });
});
test("orders show only observed latest stages while fills and exceptions remain distinct", () => {
  const frame = {
    strategies: [
      {
        id: "mm",
        symbol: "ES",
        exchange: "CME",
        position: 4,
        pnl: 3,
        orders: 1,
        fills: 1,
        latency: 20,
        state: "RUNNING",
      },
    ],
  };
  const events = [
    { id: "1", orderId: "x", time: 1, type: "ORDER_CREATED", strategyId: "mm" },
    { id: "2", orderId: "x", time: 2, type: "FILL", strategyId: "mm" },
    { id: "3", time: 3, type: "FEED_GAP", feed: "A" },
  ];
  assert.equal(operationRows(frame, events, "orders").length, 1);
  assert.equal(operationRows(frame, events, "orders")[0].type, "FILL");
  assert.equal(operationRows(frame, events, "fills")[0].id, "2");
  assert.equal(operationRows(frame, events, "exceptions")[0].id, "3");
  assert.equal(operationRows(frame, events, "positions")[0].position, 4);
  assert.equal(operationRows(frame, events, "positions")[0].venue, "CME");
});
