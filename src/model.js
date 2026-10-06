import { EXCHANGES } from "./exchanges.js";
export const STRATEGIES = [
  {
    id: "mm",
    name: "Market maker",
    symbol: "ES",
    exchange: "CME",
    pnl: 2400,
    position: 2,
    orders: 0,
    fills: 0,
    latency: 180,
    state: "RUNNING",
  },
  {
    id: "arb",
    name: "Stat arbitrage",
    symbol: "WIN_DEMO",
    exchange: "B3",
    pnl: 1600,
    position: -1,
    orders: 0,
    fills: 0,
    latency: 220,
    state: "RUNNING",
  },
  {
    id: "mom",
    name: "Momentum",
    symbol: "A5X_DEMO",
    exchange: "A5X",
    pnl: -600,
    position: 0,
    orders: 0,
    fills: 0,
    latency: 310,
    state: "RUNNING",
  },
  {
    id: "vwap",
    name: "VWAP execution",
    symbol: "AAPL",
    exchange: "NASDAQ",
    pnl: 500,
    position: 4,
    orders: 0,
    fills: 0,
    latency: 160,
    state: "RUNNING",
  },
  {
    id: "rev",
    name: "Mean reversion",
    symbol: "IBM",
    exchange: "NYSE",
    pnl: 800,
    position: -2,
    orders: 0,
    fills: 0,
    latency: 270,
    state: "RUNNING",
  },
];
export function generateSession(seed = 42, duration = 600) {
  let rng = seed >>> 0,
    seq = 0,
    order = 0;
  const frames = [],
    strategies = structuredClone(STRATEGIES).flatMap((s) => [
      s,
      {
        ...s,
        id: s.id + "_2",
        name: s.name + " II",
        pnl: Math.round(s.pnl * 0.6),
      },
    ]);
  const random = () =>
    (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296;
  const feeds = [
    { id: "A", seq: 920000, gaps: 0, state: "HEALTHY" },
    { id: "B", seq: 920000, gaps: 0, state: "HEALTHY" },
  ];
  for (let time = 0; time <= duration; time++) {
    const events = [];
    const gap = time > 0 && time % 91 === 0;
    for (const f of feeds) {
      f.seq += 1200;
      f.state = gap && f.id === "A" ? "DEGRADED" : "HEALTHY";
      if (f.state === "DEGRADED") f.gaps++;
    }
    if (gap)
      events.push({
        id: `gap-${time}`,
        type: "FEED_GAP",
        feed: "A",
        time,
        expected: feeds[0].seq - 1,
        received: feeds[0].seq,
      });
    if (time > 0 && time % 91 === 1)
      events.push({
        id: `recover-${time}`,
        type: "FEED_RECOVERED",
        feed: "A",
        time,
      });
    for (const s of strategies) {
      s.pnl += Math.round((random() - 0.46) * 70);
      s.latency = Math.round(120 + random() * 220);
      const previous = s.market?.price ?? 5000 + strategies.indexOf(s) * 100;
      const price = Math.round((previous + (random() - 0.5) * 4) * 100) / 100;
      const bars = s.market?.bars ?? [];
      bars.push({
        time,
        open: previous,
        high: Math.max(previous, price) + 0.5,
        low: Math.min(previous, price) - 0.5,
        close: price,
      });
      if (bars.length > 24) bars.shift();
      s.market = { price, bars };
      s.signal = {
        label: "Demo momentum setup",
        direction: price >= previous ? "BUY" : "SELL",
        charge: (time * 7 + strategies.indexOf(s) * 13) % 101,
        status: "WATCHING",
        updatedAt: time,
      };
      if (time > 0 && time % 24 === 0 && s.id === "mm") {
        s.signal.charge = 100;
        s.signal.status = "FIRED";
        events.push({
          id: "signal-" + time,
          type: "SIGNAL_GENERATED",
          strategyId: s.id,
          time,
          message: "Synthetic setup threshold crossed",
          charge: s.signal.charge,
        });
      }
    }
    if (time > 0 && time % 3 === 0) {
      const s = strategies[Math.floor(random() * strategies.length)];
      const side = random() > 0.5 ? "BUY" : "SELL";
      const qty = 1 + Math.floor(random() * 4);
      const price = Math.round((s.market.price + (random() - 0.5)) * 100) / 100;
      const rejected = random() < 0.08;
      const orderId = `SIM-${++order}`;
      s.orders++;
      const types = rejected
        ? ["ORDER_CREATED", "RISK_REJECTED"]
        : ["ORDER_CREATED", "RISK_PASSED", "ORDER_SENT", "ORDER_ACK", "FILL"];
      types.forEach((type, i) =>
        events.push({
          id: `${orderId}-${i}`,
          type,
          orderId,
          strategyId: s.id,
          symbol: s.symbol,
          side,
          qty,
          price,
          time: time + i * 0.002,
        }),
      );
      if (!rejected) {
        s.fills++;
        s.position += side === "BUY" ? qty : -qty;
      }
    }
    frames.push({
      version: 1,
      source: "demo",
      seq: ++seq,
      time,
      strategies: structuredClone(strategies),
      feeds: structuredClone(feeds),
      events,
    });
  }
  return {
    version: 1,
    label: "Synthetic demonstration — no real executions",
    frames,
  };
}
const finite = (n) => typeof n === "number" && Number.isFinite(n);
export function validateFrame(f) {
  if (
    !f ||
    f.version !== 1 ||
    !Number.isSafeInteger(f.seq) ||
    f.seq < 0 ||
    !finite(f.time) ||
    f.time < 0
  )
    throw Error("Invalid frame header");
  if (
    !Array.isArray(f.strategies) ||
    f.strategies.length < 1 ||
    f.strategies.length > 40 ||
    !Array.isArray(f.feeds) ||
    f.feeds.length !== 2 ||
    !Array.isArray(f.events) ||
    f.events.length > 200
  )
    throw Error("Invalid frame collections");
  if (
    f.source !== undefined &&
    !["demo", "example", "telemetry"].includes(f.source)
  )
    throw Error("Invalid frame source");
  if (
    f.dropped !== undefined &&
    (!Number.isSafeInteger(f.dropped) || f.dropped < 0)
  )
    throw Error("Invalid drop counter");
  for (const entity of [...f.strategies, ...f.feeds])
    if (
      entity.updatedAt !== undefined &&
      (!finite(entity.updatedAt) ||
        entity.updatedAt < 0 ||
        entity.updatedAt > f.time)
    )
      throw Error("Invalid entity update timestamp");
  const ids = new Set();
  for (const s of f.strategies) {
    if (
      typeof s.id !== "string" ||
      !/^[a-z][a-z0-9_]{0,31}$/.test(s.id) ||
      (s.exchange !== undefined &&
        !EXCHANGES.some((e) => e.id === s.exchange)) ||
      ids.has(s.id) ||
      typeof s.name !== "string" ||
      s.name.length > 80 ||
      typeof s.symbol !== "string" ||
      s.symbol.length > 24 ||
      !["RUNNING", "IDLE", "DEGRADED", "STOPPED"].includes(s.state) ||
      (s.signal !== undefined &&
        (!s.signal ||
          typeof s.signal.label !== "string" ||
          s.signal.label.length > 120 ||
          !["BUY", "SELL", "NEUTRAL"].includes(s.signal.direction) ||
          !finite(s.signal.charge) ||
          s.signal.charge < 0 ||
          s.signal.charge > 100 ||
          !["WATCHING", "READY", "FIRED", "IDLE"].includes(s.signal.status) ||
          !finite(s.signal.updatedAt) ||
          s.signal.updatedAt < 0 ||
          s.signal.updatedAt > f.time)) ||
      (s.market !== undefined &&
        (!s.market ||
          !finite(s.market.price) ||
          !Array.isArray(s.market.bars) ||
          s.market.bars.length > 120 ||
          s.market.bars.some(
            (b, i) =>
              !["time", "open", "high", "low", "close"].every((k) =>
                finite(b[k]),
              ) ||
              b.time < 0 ||
              b.time > f.time ||
              b.high < Math.max(b.open, b.close) ||
              b.low > Math.min(b.open, b.close) ||
              b.high < b.low ||
              (i > 0 && b.time <= s.market.bars[i - 1].time),
          ))) ||
      !finite(s.pnl) ||
      !Number.isSafeInteger(s.position) ||
      !["orders", "fills", "latency"].every(
        (k) => Number.isSafeInteger(s[k]) && s[k] >= 0,
      )
    )
      throw Error("Invalid strategy");
    ids.add(s.id);
  }
  const feeds = new Set();
  for (const x of f.feeds) {
    if (
      !["A", "B"].includes(x.id) ||
      feeds.has(x.id) ||
      !Number.isSafeInteger(x.seq) ||
      x.seq < 0 ||
      !Number.isSafeInteger(x.gaps) ||
      x.gaps < 0 ||
      !["HEALTHY", "DEGRADED", "OFFLINE"].includes(x.state)
    )
      throw Error("Invalid feed");
    feeds.add(x.id);
  }
  const eventIds = new Set();
  for (const e of f.events) {
    if (eventIds.has(e.id)) throw Error("Duplicate event ID");
    eventIds.add(e.id);
    if (
      typeof e.id !== "string" ||
      e.id.length > 120 ||
      ![
        "FEED_GAP",
        "FEED_RECOVERED",
        "SIGNAL_GENERATED",
        "PROFIT_LOCKED",
        "RISK_WARNING",
        "RISK_LIMIT_BREACHED",
        "ORDER_CREATED",
        "RISK_REJECTED",
        "RISK_PASSED",
        "ORDER_SENT",
        "ORDER_ACK",
        "FILL",
      ].includes(e.type) ||
      !finite(e.time)
    )
      throw Error("Invalid event");
    if (e.type.startsWith("FEED_")) {
      if (!["A", "B"].includes(e.feed)) throw Error("Invalid feed event");
    } else if (e.type === "SIGNAL_GENERATED") {
      if (
        !ids.has(e.strategyId) ||
        typeof e.message !== "string" ||
        e.message.length > 240 ||
        !finite(e.charge) ||
        e.charge < 0 ||
        e.charge > 100
      )
        throw Error("Invalid signal event");
    } else if (e.type === "PROFIT_LOCKED") {
      if (!ids.has(e.strategyId) || !finite(e.amount))
        throw Error("Invalid profit event");
    } else if (["RISK_WARNING", "RISK_LIMIT_BREACHED"].includes(e.type)) {
      if (
        !ids.has(e.strategyId) ||
        typeof e.message !== "string" ||
        e.message.length > 240
      )
        throw Error("Invalid risk warning");
    } else if (
      !ids.has(e.strategyId) ||
      typeof e.orderId !== "string" ||
      e.orderId.length > 120 ||
      !["BUY", "SELL"].includes(e.side) ||
      !Number.isSafeInteger(e.qty) ||
      e.qty <= 0 ||
      !finite(e.price)
    )
      throw Error("Invalid order event");
  }
  return f;
}
export function validateSession(session) {
  if (
    !session ||
    session.version !== 1 ||
    !Array.isArray(session.frames) ||
    !session.frames.length ||
    session.frames.length > 12000
  )
    throw Error("Expected a version 1 session with 1–12,000 frames");
  let lastTime = -1,
    lastSeq = -1;
  for (const f of session.frames) {
    validateFrame(f);
    if (f.time <= lastTime || f.seq <= lastSeq)
      throw Error("Frames must have increasing times and sequences");
    lastTime = f.time;
    lastSeq = f.seq;
  }
  return session;
}
export function frameAt(frames, time) {
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}
