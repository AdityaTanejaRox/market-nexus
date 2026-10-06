export const STRATEGIES = [
  {
    id: "mm",
    name: "Market maker",
    symbol: "ES",
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
    symbol: "NQ",
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
    symbol: "CL",
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
    symbol: "ZN",
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
    symbol: "GC",
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
    strategies = structuredClone(STRATEGIES);
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
    }
    if (time > 0 && time % 3 === 0) {
      const s = strategies[Math.floor(random() * strategies.length)];
      const side = random() > 0.5 ? "BUY" : "SELL";
      const qty = 1 + Math.floor(random() * 4);
      const price = Math.round((5000 + random() * 10) * 100) / 100;
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
    f.strategies.length !== 5 ||
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
  const ids = new Set();
  for (const s of f.strategies) {
    if (
      !STRATEGIES.some((x) => x.id === s.id) ||
      ids.has(s.id) ||
      typeof s.name !== "string" ||
      s.name.length > 80 ||
      typeof s.symbol !== "string" ||
      s.symbol.length > 24 ||
      !["RUNNING", "IDLE", "DEGRADED", "STOPPED"].includes(s.state) ||
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
