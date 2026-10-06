export function eventText(event) {
  const label = event.type.replaceAll("_", " ");
  if (event.type === "SIGNAL_GENERATED")
    return `${event.strategyId} · ${event.message}`;
  if (event.type === "PROFIT_LOCKED")
    return `${event.strategyId} · PROFIT LOCKED ${event.amount.toFixed(2)}`;
  if (event.orderId)
    return `${event.strategyId} · ${label} · ${event.side} ${event.qty} @ ${event.price} · ${event.orderId}`;
  return `${event.feed || event.strategyId || "SYSTEM"} · ${label}${event.message ? " · " + event.message : ""}`;
}
export function priceSeries(strategy, events = []) {
  if (strategy.market?.bars?.length)
    return {
      label: "Supplied market OHLC",
      bars: strategy.market.bars,
      price: strategy.market.price,
    };
  const fills = events
    .filter((e) => e.strategyId === strategy.id && e.type === "FILL")
    .sort((a, b) => a.time - b.time)
    .slice(-60);
  return {
    label: fills.length
      ? "Execution prices — not market candles"
      : "Market data not supplied",
    bars: fills.map((e) => ({
      time: e.time,
      open: e.price,
      high: e.price,
      low: e.price,
      close: e.price,
      execution: true,
      side: e.side,
    })),
    price: fills.at(-1)?.price ?? null,
  };
}
export function snapshotCards(frames, count = 12) {
  if (!frames.length) return [];
  const indexes = [
    ...new Set(
      Array.from({ length: Math.min(count, frames.length) }, (_, i) =>
        Math.round(
          (i * (frames.length - 1)) / (Math.min(count, frames.length) - 1 || 1),
        ),
      ),
    ),
  ];
  return indexes.map((i) => ({
    id: `frame-${frames[i].seq}`,
    label: `T+${frames[i].time.toFixed(0)}s`,
    time: frames[i].time,
    pnl: frames[i].strategies.reduce((sum, s) => sum + s.pnl, 0),
    source: frames[i].source || "imported",
  }));
}
