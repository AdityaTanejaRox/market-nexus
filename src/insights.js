// Health uses receipt time for the live stream and optional producer timestamps per entity.
export function entityHealth(
  entity,
  {
    live = false,
    connected = true,
    lastReceived = 0,
    now = 0,
    frameTime = 0,
  } = {},
) {
  const updated = entity.updatedAt ?? frameTime;
  if (live && !connected)
    return { state: "DISCONNECTED", color: 0xff637d, updated, age: null };
  if (live && !lastReceived)
    return { state: "WAITING", color: 0x9296b0, updated, age: null };
  const age = live
    ? Math.max((now - lastReceived) / 1000, frameTime - updated)
    : Math.max(0, frameTime - updated);
  if (age >= 3) return { state: "STALE", color: 0xa888ff, updated, age };
  const state =
    entity.state === "HEALTHY" || entity.state === "RUNNING"
      ? "HEALTHY"
      : entity.state;
  const colors = {
    HEALTHY: 0x38eeff,
    IDLE: 0x9296b0,
    STOPPED: 0xff637d,
    OFFLINE: 0xff637d,
    DEGRADED: 0xffbb55,
  };
  return { state, color: colors[state] ?? 0x9296b0, updated, age };
}
export function indexedEvents(frames) {
  return frames.flatMap((f) =>
    f.events.map((e) => ({ ...e, frameTime: f.time, seq: f.seq })),
  );
}
export function bookmarks(events) {
  const result = events
    .filter((e) =>
      [
        "FEED_GAP",
        "FEED_RECOVERED",
        "RISK_REJECTED",
        "RISK_WARNING",
        "RISK_LIMIT_BREACHED",
      ].includes(e.type),
    )
    .map((e) => ({ ...e, label: e.type.replaceAll("_", " ") }));
  const largest = events
    .filter((e) => e.type === "FILL")
    .reduce((best, e) => (!best || e.qty > best.qty ? e : best), null);
  if (largest)
    result.push({
      ...largest,
      label: `LARGEST FILL · ${largest.qty} contracts`,
    });
  return result.sort((a, b) => a.frameTime - b.frameTime || a.time - b.time);
}
export function orderStages(events, orderId) {
  const seen = new Set();
  return events
    .filter((e) => e.orderId === orderId && !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.time - b.time);
}
export function lifecycleRows(events, orderId) {
  const stages = orderStages(events, orderId);
  return stages.map((e, i) => ({
    ...e,
    deltaUs: i ? (e.time - stages[i - 1].time) * 1e6 : null,
  }));
}
