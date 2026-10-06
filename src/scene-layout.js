// Deterministic architecture: geometry is decorative; charts and activity use telemetry.
export function cityLayout(seed = 731) {
  let value = seed >>> 0;
  const random = () =>
    (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296;
  const landmarks = Array.from({ length: 5 }, (_, i) => {
    const angle = (i / 5) * Math.PI * 2 - 0.45;
    return {
      x: Math.cos(angle) * 10.2,
      z: Math.sin(angle) * 10.2,
      height: 7.5 + i * 0.6,
    };
  });
  const buildings = [];
  for (const [district, center] of landmarks.entries()) {
    for (let row = -2; row <= 2; row++)
      for (let column = -2; column <= 2; column++) {
        if (Math.abs(row) <= 1 && Math.abs(column) <= 1) continue;
        buildings.push({
          x: center.x + column * 1.12,
          z: center.z + row * 1.12,
          y: 0.3,
          width: 0.55 + random() * 0.35,
          depth: 0.55 + random() * 0.35,
          height: 0.8 + random() * 3.5,
          district,
        });
      }
  }
  for (let i = 0; i < 115; i++) {
    const angle = random() * Math.PI * 2,
      radius = 4.8 + random() * 10.2;
    const x = Math.cos(angle) * radius,
      z = Math.sin(angle) * radius;
    if (landmarks.some((t) => Math.hypot(t.x - x, t.z - z) < 3.4)) continue;
    buildings.push({
      x,
      z,
      y: 0,
      width: 0.4 + random() * 0.5,
      depth: 0.4 + random() * 0.5,
      height: 0.5 + random() * 2.3,
      district: 5,
    });
  }
  const satellites = [
    { x: -23, z: -4, y: -1.4, r: 4, id: "A" },
    { x: -18, z: -15, y: -2.3, r: 3.5, id: "B" },
    { x: 21, z: 9, y: -2, r: 4, id: "gateway" },
  ];
  for (const [index, s] of satellites.entries())
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2,
        r = 1.6 + random() * 1.2;
      buildings.push({
        x: s.x + Math.cos(a) * r,
        z: s.z + Math.sin(a) * r,
        y: s.y,
        width: 0.4 + random() * 0.4,
        depth: 0.4 + random() * 0.4,
        height: 1 + random() * 2.8,
        district: 6 + index,
      });
    }
  return { landmarks, buildings, satellites };
}
