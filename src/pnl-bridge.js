import * as T from "three";

// The elevated chart is sourced exclusively from recorded total P&L snapshots.
export function pnlBridgePoints(frames, strategyId = null, bounds = null) {
  const samples = frames
    .filter((f) => !strategyId || f.strategies.some((s) => s.id === strategyId))
    .slice(-240);
  if (!samples.length) return [];
  const values = samples.map((f) =>
    strategyId
      ? f.strategies.find((s) => s.id === strategyId).pnl
      : f.strategies.reduce((sum, s) => sum + s.pnl, 0),
  );
  const low = bounds?.low ?? Math.min(0, ...values),
    high = bounds?.high ?? Math.max(0, ...values),
    span = high - low || 1;
  const first = samples[0].time,
    duration = samples.at(-1).time - first || 1;
  return samples.map(
    (f, i) =>
      new T.Vector3(
        -13 + (26 * (f.time - first)) / duration,
        3.5 + (6 * (values[i] - low)) / span,
        -14,
      ),
  );
}

export function createPnlBridge(scene, targets, options = {}) {
  const group = new T.Group();
  scene.add(group);
  const id = options.strategyId
    ? "pnl-bridge-" + options.strategyId
    : "pnl-bridge";
  if (options.position) group.position.copy(options.position);
  group.rotation.y = options.rotation || 0;
  group.scale.setScalar(options.scale || 1);
  const neon = (color) =>
    new T.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      toneMapped: false,
    });
  const part = (geometry, material, position) => {
    const mesh = new T.Mesh(geometry, material);
    mesh.position.copy(position);
    group.add(mesh);
    return mesh;
  };
  const deck = part(
    new T.BoxGeometry(28, 0.25, 1.4),
    new T.MeshStandardMaterial({
      color: 0x172249,
      metalness: 0.6,
      roughness: 0.4,
    }),
    new T.Vector3(0, 3, -14),
  );
  deck.userData.id = id;
  targets.push(deck);
  for (const x of [-14, 14]) {
    part(
      new T.BoxGeometry(0.35, 6, 0.35),
      neon(0x68e8ff),
      new T.Vector3(x, 3, -14),
    );
    part(
      new T.CylinderGeometry(0.6, 0.8, 0.4, 16),
      neon(0x83ffe5),
      new T.Vector3(x, 0.2, -14),
    );
  }
  for (const z of [-14.65, -13.35])
    part(
      new T.BoxGeometry(28, 0.045, 0.045),
      neon(0x86f6e5),
      new T.Vector3(0, 3.3, z),
    );
  const panel = part(
    new T.BoxGeometry(27, 7, 0.08),
    new T.MeshBasicMaterial({
      color: 0x081b37,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
    new T.Vector3(0, 6.7, -14.2),
  );
  panel.userData.id = id;
  targets.push(panel);
  const geometry = new T.BufferGeometry();
  const line = new T.Line(
    geometry,
    new T.LineBasicMaterial({
      color: options.color ?? 0x67ffd4,
      toneMapped: false,
    }),
  );
  group.add(line);
  const zeroGeometry = new T.BufferGeometry();
  const zeroLine = new T.Line(
    zeroGeometry,
    new T.LineBasicMaterial({
      color: 0xa5b3bc,
      transparent: true,
      opacity: 0.65,
    }),
  );
  group.add(zeroLine);
  const stems = new T.LineSegments(
    new T.BufferGeometry(),
    new T.LineBasicMaterial({
      color: 0x44bba8,
      transparent: true,
      opacity: 0.3,
    }),
  );
  group.add(stems);
  geometry.setAttribute(
    "position",
    new T.BufferAttribute(new Float32Array(240 * 3), 3),
  );
  stems.geometry.setAttribute(
    "position",
    new T.BufferAttribute(new Float32Array(80 * 3), 3),
  );
  function writePoints(target, points) {
    const attribute = target.attributes.position;
    points.forEach((p, i) => attribute.setXYZ(i, p.x, p.y, p.z));
    attribute.needsUpdate = true;
    target.setDrawRange(0, points.length);
    target.computeBoundingSphere();
  }
  return {
    group,
    update(frames, bounds = null) {
      const points = pnlBridgePoints(frames, options.strategyId, bounds);
      const latest = frames
        .at(-1)
        ?.strategies.find((s) => s.id === options.strategyId);
      line.material.color.setHex(
        latest?.pnl < 0 ? 0xff82bd : (options.color ?? 0x67ffd4),
      );
      writePoints(geometry, points);
      const scope = frames.slice(-240).flatMap((f) =>
        options.strategyId
          ? f.strategies.filter((s) => s.id === options.strategyId).map((s) => s.pnl)
          : [f.strategies.reduce((sum, s) => sum + s.pnl, 0)],
      );
      const low = bounds?.low ?? Math.min(0, ...scope),
        high = bounds?.high ?? Math.max(0, ...scope),
        y = 3.5 + (6 * (0 - low)) / (high - low || 1);
      zeroGeometry.dispose();
      zeroGeometry.setAttribute(
        "position",
        new T.Float32BufferAttribute([-13, y, -14, 13, y, -14], 3),
      );
      zeroGeometry.computeBoundingSphere();
      writePoints(
        stems.geometry,
        points
          .filter((_, i) => i % 6 === 0)
          .flatMap((p) => [new T.Vector3(p.x, 3.3, p.z), p]),
      );
    },
  };
}
