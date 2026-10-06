import test from "node:test";
import assert from "node:assert/strict";
import { generateSession, validateFrame } from "../src/model.js";
import { eventText, priceSeries, snapshotCards } from "../src/presentation.js";
test("demo supplies valid market candles and labeled signal events", () => {
  const session = generateSession(42, 60);
  for (const frame of session.frames) validateFrame(frame);
  const frame = session.frames[24];
  assert.equal(frame.strategies[0].signal.charge, 100);
  assert.equal(frame.strategies[0].signal.status, "FIRED");
  assert.ok(frame.events.some((e) => e.type === "SIGNAL_GENERATED"));
});
test("price fallback is labeled execution data and never invents market candles", () => {
  const s = { id: "mm" };
  assert.equal(priceSeries(s).price, null);
  assert.equal(priceSeries(s).bars.length, 0);
  const series = priceSeries(s, [
    { type: "FILL", strategyId: "mm", price: 100, time: 2, side: "BUY" },
  ]);
  assert.ok(series.label.includes("not market candles"));
  assert.equal(series.bars[0].high, 100);
});
test("invalid candles and impossible signal charge are rejected", () => {
  const f = generateSession(1, 1).frames[1];
  f.strategies[0].market.bars[0].high = -100;
  assert.throws(() => validateFrame(f));
  const g = generateSession(1, 0).frames[0];
  g.strategies[0].signal.charge = 101;
  assert.throws(() => validateFrame(g));
});
test("history samples actual source snapshots with stable endpoints", () => {
  const { frames } = generateSession(1, 20);
  const cards = snapshotCards(frames, 8);
  assert.equal(cards.length, 8);
  assert.equal(cards[0].time, 0);
  assert.equal(cards.at(-1).time, 20);
  assert.equal(
    cards.at(-1).pnl,
    frames.at(-1).strategies.reduce((n, s) => n + s.pnl, 0),
  );
  assert.deepEqual(snapshotCards([]), []);
});
test("marquee messages preserve event meaning without inventing profit", () => {
  const fill = eventText({
    type: "FILL",
    strategyId: "mm",
    orderId: "9",
    side: "BUY",
    qty: 2,
    price: 100,
  });
  assert.ok(fill.includes("BUY 2 @ 100"));
  assert.ok(!fill.includes("PROFIT"));
  assert.ok(
    eventText({ type: "PROFIT_LOCKED", strategyId: "mm", amount: 12 }).includes(
      "12.00",
    ),
  );
});
