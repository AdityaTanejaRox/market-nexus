export const DEFAULT_WORKSPACE = {
  theme: "professional",
  tab: "orders",
  scale: "shared",
  autoFocus: false,
  monitors: false,
  tickerPaused: false,
};
export function sanitizeWorkspace(value = {}) {
  return {
    theme: ["professional", "showcase"].includes(value.theme)
      ? value.theme
      : "professional",
    tab: ["orders", "fills", "positions", "exceptions"].includes(value.tab)
      ? value.tab
      : "orders",
    scale: ["shared", "individual"].includes(value.scale)
      ? value.scale
      : "shared",
    autoFocus: value.autoFocus === true,
    monitors: value.monitors === true,
    tickerPaused: value.tickerPaused === true,
  };
}
export function pnlBounds(frames, strategyId = null, shared = false) {
  const values = frames
    .slice(-240)
    .flatMap((f) =>
      f.strategies
        .filter((s) => shared || !strategyId || s.id === strategyId)
        .map((s) => s.pnl),
    );
  if (!strategyId && !shared) {
    values.length = 0;
    for (const f of frames.slice(-240))
      values.push(f.strategies.reduce((n, s) => n + s.pnl, 0));
  }
  return { low: Math.min(0, ...values), high: Math.max(0, ...values) };
}
export function operationRows(frame, events, tab) {
  if (tab === "positions")
    return frame.strategies.map((s) => ({
      key: s.id,
      strategy: s.id,
      venue: s.exchange || "UNASSIGNED",
      instrument: s.symbol,
      state: s.state,
      position: s.position,
      pnl: s.pnl,
      orders: s.orders,
      fills: s.fills,
      latency: s.latency,
    }));
  const ordered = [...events].sort((a, b) => b.time - a.time);
  if (tab === "exceptions")
    return ordered
      .filter((e) =>
        [
          "FEED_GAP",
          "FEED_RECOVERED",
          "RISK_REJECTED",
          "RISK_WARNING",
          "RISK_LIMIT_BREACHED",
        ].includes(e.type),
      )
      .map((e) => ({
        ...e,
        key: e.id,
        severity:
          e.type === "FEED_RECOVERED"
            ? "INFO"
            : e.type === "RISK_LIMIT_BREACHED"
              ? "CRITICAL"
              : "WARNING",
      }));
  if (tab === "fills")
    return ordered
      .filter((e) => e.type === "FILL")
      .map((e) => ({ ...e, key: e.id }));
  const seen = new Set();
  return ordered
    .filter((e) => e.orderId && !seen.has(e.orderId) && seen.add(e.orderId))
    .map((e) => ({ ...e, key: e.orderId }));
}
