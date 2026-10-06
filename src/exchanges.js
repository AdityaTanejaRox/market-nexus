// Venue identity is supplied by the producer, never inferred from an instrument symbol.
export const EXCHANGES = [
  { id: "CME", color: 0x66f5e0, x: -38, z: -25 },
  { id: "B3", color: 0xffd58a, x: 0, z: -46 },
  { id: "A5X", color: 0xce9aff, x: 38, z: -25 },
  { id: "NASDAQ", color: 0x79bfff, x: 31, z: 26 },
  { id: "NYSE", color: 0xff82c7, x: -31, z: 26 },
  { id: "UNASSIGNED", color: 0x9cabc0, x: 0, z: 53 },
];
export function exchangeOf(strategy) {
  return strategy.exchange || "UNASSIGNED";
}
export function exchangeTotals(strategies) {
  return EXCHANGES.map((e) => ({
    ...e,
    strategies: strategies.filter((s) => exchangeOf(s) === e.id),
    pnl: strategies
      .filter((s) => exchangeOf(s) === e.id)
      .reduce((n, s) => n + s.pnl, 0),
  }));
}
export function stateLayout(strategies) {
  return exchangeTotals(strategies).map((city) => ({
    ...city,
    towers: city.strategies
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s, i) => {
        const count = city.strategies.length,
          ring = Math.floor(i / 8),
          inRing = Math.min(8, count - ring * 8),
          a = (2 * Math.PI * (i % 8)) / inRing;
        const radius = count === 1 ? 4 : 5.5 + ring * 3;
        return {
          id: s.id,
          exchange: city.id,
          x: city.x + Math.cos(a) * radius,
          z: city.z + Math.sin(a) * radius,
          height: 8,
          index: i,
        };
      }),
  }));
}
