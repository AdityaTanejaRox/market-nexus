import * as T from "three";
import { pnlBounds } from "./workstation.js";
import { EXCHANGES, exchangeOf, stateLayout } from "./exchanges.js";
import { createPnlBridge } from "./pnl-bridge.js";
import { priceSeries, eventText } from "./presentation.js";
export function hovercar(index) {
  const group = new T.Group(),
    color = index % 2 ? 0xff70dc : 0x71efff;
  const shell = new T.MeshStandardMaterial({
    color: 0x202b59,
    metalness: 0.8,
    roughness: 0.25,
  });
  const glow = new T.MeshBasicMaterial({ color, toneMapped: false });
  const part = (geometry, material, x, y, z) => {
    const m = new T.Mesh(geometry, material);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const hull = part(new T.BoxGeometry(0.65, 0.18, 1.35), shell, 0, 0, 0);
  hull.userData.id = `vehicle-${index}`;
  part(
    new T.BoxGeometry(0.46, 0.2, 0.65),
    new T.MeshStandardMaterial({
      color: 0x64b6ef,
      emissive: 0x133c73,
      transparent: true,
      opacity: 0.8,
    }),
    0,
    0.18,
    0.04,
  );
  part(new T.BoxGeometry(1.1, 0.06, 0.42), shell, 0, -0.035, -0.2);
  for (const x of [-0.25, 0.25]) {
    part(new T.SphereGeometry(0.07, 8, 8), glow, x, 0.02, 0.67);
    part(new T.CylinderGeometry(0.1, 0.1, 0.12, 8), glow, x, -0.13, -0.42);
    const exhaust = part(
      new T.ConeGeometry(0.1, 0.65, 8),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        toneMapped: false,
        depthWrite: false,
      }),
      x,
      0,
      -0.93,
    );
    exhaust.rotation.x = -Math.PI / 2;
  }
  group.userData = { id: `vehicle-${index}`, hull };
  return group;
}
export function createCityExtras({
  scene,
  towers,
  targets,
  canvasSprite,
  textPanel,
  billboard,
  add,
  neon,
  ring,
}) {
  const pnlBridge = createPnlBridge(scene, targets);
  const bridgeLabel = billboard(
    "P&L CHART BRIDGE",
    ["Recorded session totals · click to inspect"],
    new T.Vector3(0, 11, -14),
    8,
  );
  bridgeLabel.userData.id = "pnl-bridge";
  targets.push(bridgeLabel);
  const strategyBridges = new Map();
  const charts = new Map(),
    scanners = new Map(),
    bursts = [],
    announcements = [],
    memories = [];
  let professionalMode = true,
    scaleMode = "shared";
  let activeStrategy = "mm",
    lastFrame = null,
    lastHistory = [],
    log = [];
  function interactive(sprite, id) {
    sprite.userData.id = id;
    targets.push(sprite);
    return sprite;
  }
  function syncDisplays(frame) {
    const active = new Set(frame.strategies.map((s) => s.id));
    for (const [id, chart] of charts)
      if (!active.has(id)) {
        dispose(chart);
        dispose(scanners.get(id));
        charts.delete(id);
        scanners.delete(id);
      }
    for (const [id, bridge] of strategyBridges)
      if (!active.has(id)) {
        dispose(bridge.group);
        dispose(bridge.label);
        strategyBridges.delete(id);
      }
    for (const city of stateLayout(frame.strategies))
      for (const [index, spec] of city.towers.entries()) {
        const t = towers.get(spec.id);
        if (!t) continue;
        if (!charts.has(spec.id)) {
          const chart = canvasSprite(600, 300, 5.1);
          chart.position.set(3.6, 7.3, -1);
          t.group.add(chart);
          interactive(chart, "chart-" + spec.id);
          charts.set(spec.id, chart);
          const scanner = canvasSprite(500, 270, 4.5);
          scanner.position.set(0, 2.8, 3);
          t.group.add(scanner);
          interactive(scanner, "scanner-" + spec.id);
          scanners.set(spec.id, scanner);
        }
        if (!strategyBridges.has(spec.id)) {
          const bridge = createPnlBridge(scene, targets, {
            strategyId: spec.id,
            color: city.color,
            scale: 0.32,
          });
          bridge.label = billboard(
            spec.id + " P&L BRIDGE",
            [],
            new T.Vector3(),
            4.5,
            "#" + city.color.toString(16),
          );
          interactive(bridge.label, "pnl-bridge-" + spec.id);
          strategyBridges.set(spec.id, bridge);
        }
        const bridge = strategyBridges.get(spec.id);
        // Each strategy's physical chart bridge reaches from its tower district to the city rim.
        const a = new T.Vector3(spec.x, 0, spec.z),
          angle = Math.atan2(spec.z - city.z, spec.x - city.x) + 0.4;
        const b = new T.Vector3(
          city.x + Math.cos(angle) * 13,
          0,
          city.z + Math.sin(angle) * 13,
        );
        const middle = a.clone().lerp(b, 0.5),
          rotation = Math.atan2(-(b.z - a.z), b.x - a.x),
          scale = a.distanceTo(b) / 28;
        bridge.group.scale.setScalar(scale);
        bridge.group.rotation.y = rotation;
        bridge.group.position.copy(
          middle
            .clone()
            .add(
              new T.Vector3(0, 0, 14 * scale).applyAxisAngle(
                new T.Vector3(0, 1, 0),
                rotation,
              ),
            ),
        );
        bridge.label.position.copy(
          middle.clone().add(new T.Vector3(0, 7 * scale + 2, 0)),
        );
      }
  }
  const room = new T.Group();
  room.position.set(30, -1, -16);
  scene.add(room);
  add(
    new T.CylinderGeometry(5.5, 4.8, 0.6, 48),
    new T.MeshStandardMaterial({
      color: 0x161636,
      metalness: 0.5,
      roughness: 0.4,
    }),
    new T.Vector3(0, -0.3, 0),
    room,
  );
  ring(5.4, 0, 0x6af7db, room);
  const desk = add(
    new T.BoxGeometry(6, 0.25, 2),
    new T.MeshStandardMaterial({
      color: 0x122438,
      metalness: 0.7,
      roughness: 0.3,
    }),
    new T.Vector3(0, 1.5, -1),
    room,
  );
  desk.userData.id = "workstation";
  targets.push(desk);
  for (const x of [-2.5, 2.5])
    add(
      new T.BoxGeometry(0.16, 1.5, 0.16),
      neon(0x67e6ff, 0.6),
      new T.Vector3(x, 0.75, -1),
      room,
    );
  add(
    new T.BoxGeometry(1.4, 0.08, 0.5),
    neon(0x235168),
    new T.Vector3(0, 1.67, -0.4),
    room,
  );
  for (let i = 0; i < 10; i++)
    add(
      new T.BoxGeometry(0.085, 0.015, 0.09),
      neon(0x88d7ff),
      new T.Vector3((i - 4.5) * 0.13, 1.72, -0.4),
      room,
    );
  const white = new T.MeshStandardMaterial({
    color: 0xe1f0ff,
    metalness: 0.45,
    roughness: 0.25,
  });
  const robot = new T.Group();
  robot.position.set(0, 0, 1);
  room.add(robot);
  add(
    new T.CylinderGeometry(0.43, 0.6, 1.3, 12),
    white,
    new T.Vector3(0, 1.35, 0),
    robot,
  );
  const head = add(
    new T.SphereGeometry(0.57, 24, 16),
    white,
    new T.Vector3(0, 2.55, 0),
    robot,
  );
  const visor = add(
    new T.BoxGeometry(0.76, 0.22, 0.15),
    neon(0x2bf6ff),
    new T.Vector3(0, 2.6, -0.47),
    robot,
  );
  for (const x of [-0.6, 0.6]) {
    const arm = add(
      new T.CapsuleGeometry(0.14, 0.8, 4, 8),
      white,
      new T.Vector3(x, 1.65, -0.25),
      robot,
    );
    arm.rotation.x = -0.9;
    arm.rotation.z = x > 0 ? -0.3 : 0.3;
    add(
      new T.SphereGeometry(0.2, 12, 8),
      neon(0x47ddd3),
      new T.Vector3(x, 1.5, -0.7),
      robot,
    );
  }
  add(
    new T.CylinderGeometry(0.65, 0.75, 0.3, 12),
    new T.MeshStandardMaterial({ color: 0x323d67 }),
    new T.Vector3(0, 0.55, 0),
    robot,
  );
  const screen = canvasSprite(760, 370, 5.8);
  screen.position.set(30, 3.8, -17.2);
  scene.add(screen);
  interactive(screen, "workstation");
  const sideScreen = canvasSprite(500, 270, 3.4);
  sideScreen.position.set(33.5, 3.2, -16.4);
  scene.add(sideScreen);
  interactive(sideScreen, "workstation");
  const title = billboard(
    "STRATEGY WORKSTATION",
    ["Decorative operator / sourced monitors"],
    new T.Vector3(30, 6, -16),
    5.4,
  );
  const memoryGroup = new T.Group();
  scene.add(memoryGroup);
  function histories(cards) {
    for (const entry of memories) {
      targets.splice(targets.indexOf(entry.mesh), 1);
      memoryGroup.remove(entry.group);
      entry.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose();
        o.material?.dispose();
      });
    }
    memories.length = 0;
    cards.slice(0, 12).forEach((card, i) => {
      const g = new T.Group();
      g.position.set(
        (i - (Math.min(cards.length, 12) - 1) / 2) * 2.6,
        -3.5,
        23,
      );
      memoryGroup.add(g);
      const height = 0.5 + Math.min(Math.abs(card.pnl) / 5000, 2.7);
      const color = card.pnl < 0 ? 0xff65a8 : 0x63ead7;
      const mesh = add(
        new T.BoxGeometry(0.65, height, 0.65),
        new T.MeshStandardMaterial({
          color: 0x26355e,
          emissive: color,
          emissiveIntensity: 0.3,
        }),
        new T.Vector3(0, height / 2, 0),
        g,
      );
      mesh.userData.id = "history-" + i;
      targets.push(mesh);
      for (let b = 0; b < 4; b++)
        add(
          new T.BoxGeometry(0.25, 0.5 + b * 0.15, 0.3),
          new T.MeshStandardMaterial({
            color: 0x27356e,
            emissive: 0x5974be,
            emissiveIntensity: 0.2,
          }),
          new T.Vector3(
            (b % 2 ? 1 : -1) * 0.45,
            0.3 + b * 0.07,
            Math.floor(b / 2) * 0.6,
          ),
          g,
        );
      const label = canvasSprite(320, 150, 2.4);
      label.position.set(0, -0.6, 1);
      g.add(label);
      textPanel(
        label,
        card.label,
        [
          `${card.pnl < 0 ? "-" : "+"}$${Math.abs(card.pnl).toFixed(0)}`,
          card.source,
        ],
        card.pnl < 0 ? "#ff78ad" : "#79ffe5",
      );
      memories.push({ group: g, mesh, card });
    });
  }
  function chart(sprite, strategy, events) {
    const { canvas: c, context: x, texture } = sprite.userData;
    const series = priceSeries(strategy, events);
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = "rgba(3,8,30,.92)";
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = "#698dff";
    x.lineWidth = 2;
    x.strokeRect(1, 1, c.width - 2, c.height - 2);
    x.fillStyle = "#7ae8ff";
    x.font = "bold 23px monospace";
    x.fillText(
      strategy.symbol +
        " / " +
        (series.price === null ? "NO PRICE" : series.price.toFixed(2)),
      16,
      30,
    );
    x.fillStyle = "#919bbd";
    x.font = "14px monospace";
    x.fillText(series.label, 16, 53);
    const bars = series.bars.slice(-45);
    if (bars.length) {
      const low = Math.min(...bars.map((b) => b.low)),
        high = Math.max(...bars.map((b) => b.high)),
        span = high - low || 1;
      const py = (v) => 70 + (1 - (v - low) / span) * (c.height - 98);
      x.strokeStyle = "#242c59";
      for (let j = 0; j < 4; j++) {
        x.beginPath();
        x.moveTo(14, 75 + j * 50);
        x.lineTo(c.width - 12, 75 + j * 50);
        x.stroke();
      }
      bars.forEach((b, i) => {
        const px = 18 + (i / (bars.length - 1 || 1)) * (c.width - 36);
        x.strokeStyle = b.close >= b.open ? "#62ffd7" : "#ff699c";
        x.fillStyle = x.strokeStyle;
        x.beginPath();
        x.moveTo(px, py(b.high));
        x.lineTo(px, py(b.low));
        x.stroke();
        x.fillRect(
          px - 3,
          Math.min(py(b.open), py(b.close)),
          6,
          Math.max(2, Math.abs(py(b.open) - py(b.close))),
        );
      });
      events
        .filter(
          (e) =>
            e.type === "FILL" &&
            e.strategyId === strategy.id &&
            e.time >= bars[0].time &&
            e.time <= bars.at(-1).time,
        )
        .slice(-15)
        .forEach((e) => {
          const px =
              18 +
              ((e.time - bars[0].time) /
                (bars.at(-1).time - bars[0].time || 1)) *
                (c.width - 36),
            y = Math.max(75, Math.min(c.height - 20, py(e.price)));
          x.fillStyle = "#ffe288";
          x.beginPath();
          x.moveTo(px, y - 7);
          x.lineTo(px - 5, y + 2);
          x.lineTo(px + 5, y + 2);
          x.fill();
        });
    }
    texture.needsUpdate = true;
  }
  function scanner(sprite, strategy, events) {
    const { canvas: c, context: x, texture } = sprite.userData;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = professionalMode ? "rgba(26,36,46,.96)" : "rgba(4,8,26,.95)";
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = "#66ffd4";
    x.lineWidth = 2;
    x.strokeRect(1, 1, c.width - 2, c.height - 2);
    x.fillStyle = professionalMode ? "#bccbd7" : "#70ffcb";
    x.font = "bold 24px monospace";
    x.fillText("SIGNAL SCANNER / " + strategy.symbol, 14, 32);
    const signal = strategy.signal;
    x.font = "16px monospace";
    x.fillStyle = "#d9eeff";
    x.fillText(
      signal ? signal.label.slice(0, 43) : "Signal telemetry not supplied",
      14,
      58,
    );
    x.fillStyle = "#25234c";
    x.fillRect(14, 77, c.width - 28, 23);
    if (signal) {
      x.fillStyle = professionalMode
        ? "#7f95a8"
        : signal.direction === "SELL"
          ? "#ff59a1"
          : "#5affce";
      x.fillRect(14, 77, ((c.width - 28) * signal.charge) / 100, 23);
      x.fillStyle = "#ffffff";
      x.fillText(
        `${signal.charge.toFixed(0)}% · ${signal.direction} · ${signal.status}`,
        20,
        95,
      );
    }
    x.fillStyle = "#9eacc9";
    x.fillText("OBSERVED ACTIVITY", 14, 124);
    x.font = "13px monospace";
    events
      .filter((e) => e.strategyId === strategy.id)
      .slice(-6)
      .reverse()
      .forEach((e, i) => {
        x.fillStyle = e.type.includes("REJECT") ? "#ff79ab" : "#dce8f5";
        x.fillText(
          e.time.toFixed(2) + " " + eventText(e).slice(0, 51),
          14,
          147 + i * 19,
        );
      });
    texture.needsUpdate = true;
  }
  function update(frame, events = [], history = []) {
    syncDisplays(frame);
    lastFrame = frame;
    lastHistory = history;
    pnlBridge.update(history);
    textPanel(
      bridgeLabel,
      "P&L CHART BRIDGE",
      [
        "TOTAL $" + frame.strategies.reduce((n, s) => n + s.pnl, 0).toFixed(2),
        "Recorded snapshots · click for chart",
      ],
      "#75ffe0",
    );
    log = events;
    for (const s of frame.strategies) {
      const bridge = strategyBridges.get(s.id);
      if (bridge) {
        const bounds = pnlBounds(history, s.id, scaleMode === "shared");
        bridge.update(history, bounds);
        textPanel(
          bridge.label,
          s.name + " P&L",
          [
            exchangeOf(s) + " CITY",
            (s.pnl < 0 ? "-" : "+") + "$" + Math.abs(s.pnl).toFixed(0),
            "USD [" +
              bounds.low.toFixed(0) +
              ", " +
              bounds.high.toFixed(0) +
              "] " +
              scaleMode,
          ],
          s.pnl < 0 ? "#ff81bd" : "#8affdc",
        );
      }
      charts.get(s.id).visible = scanners.get(s.id).visible =
        !professionalMode || s.id === activeStrategy;
      chart(charts.get(s.id), s, events);
      scanner(scanners.get(s.id), s, events);
    }
    const strategy =
      frame.strategies.find((s) => s.id === activeStrategy) ||
      frame.strategies[0];
    if (!strategy) return;
    chart(screen, strategy, events);
    scanner(sideScreen, strategy, events);
    textPanel(title, strategy.name, [
      "OPERATOR WORKSTATION",
      frame.source?.toUpperCase() || "IMPORTED",
    ]);
  }
  function burst(position, color, label, event = null) {
    if (professionalMode) {
      if (
        !event ||
        ![
          "RISK_REJECTED",
          "RISK_WARNING",
          "RISK_LIMIT_BREACHED",
          "FEED_GAP",
        ].includes(event.type)
      )
        return;
      if (announcements.length >= 8) dispose(announcements.shift().sprite);
      const sprite = billboard(
        label,
        [event.time.toFixed(3) + "s"],
        position.clone().add(new T.Vector3(0, 1.5, 0)),
        2.2,
        "#cbb58b",
      );
      sprite.userData.id = "event-" + event.id;
      targets.push(sprite);
      announcements.push({ sprite, age: 0 });
      return;
    }
    if (bursts.length >= 14) return;
    const group = new T.Group();
    group.position.copy(position);
    scene.add(group);
    const glow = add(
      new T.SphereGeometry(0.5, 16, 12),
      neon(color, 0.7),
      new T.Vector3(),
      group,
    );
    const energy = add(
      new T.IcosahedronGeometry(1, 2),
      new T.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
        depthWrite: false,
      }),
      new T.Vector3(),
      group,
    );
    const halos = [
      ring(0.4, 0, color, group, 0.09),
      ring(0.3, 0.1, color, group, 0.045),
    ];
    halos[1].rotation.x = 0.3;
    const count = 180,
      positions = new Float32Array(count * 3),
      velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996,
        y = 1 - (2 * i) / count,
        r = Math.sqrt(1 - y * y),
        speed = 2.5 + (i % 7) * 0.4;
      velocities[i * 3] = Math.cos(a) * r * speed;
      velocities[i * 3 + 1] = y * speed;
      velocities[i * 3 + 2] = Math.sin(a) * r * speed;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    const sparks = new T.Points(
      geometry,
      new T.PointsMaterial({
        color,
        size: 0.12,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: T.AdditiveBlending,
        toneMapped: false,
      }),
    );
    sparks.frustumCulled = false;
    group.add(sparks);
    bursts.push({
      group,
      glow,
      energy,
      halos,
      sparks,
      positions,
      velocities,
      age: 0,
    });
    if (announcements.length >= 8) {
      const old = announcements.shift();
      dispose(old.sprite);
    }
    const sprite = billboard(
      label,
      [],
      position.clone().add(new T.Vector3(0, 3, 0)),
      4.2,
      "#" + color.toString(16).padStart(6, "0"),
    );
    if (event) {
      sprite.userData.id = "event-" + event.id;
      targets.push(sprite);
    }
    announcements.push({ sprite, age: 0 });
  }
  function dispose(object) {
    const removed = new Set();
    object.traverse((o) => removed.add(o));
    for (let i = targets.length - 1; i >= 0; i--)
      if (removed.has(targets[i])) targets.splice(i, 1);
    object.parent?.remove(object);
    object.traverse((o) => {
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    });
  }
  function animate(dt, elapsed) {
    robot.visible = !professionalMode;
    head.rotation.y = Math.sin(elapsed * 0.4) * 0.12;
    robot.position.y = Math.sin(elapsed * 1.3) * 0.025;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.age += dt;
      const p = b.age / 2;
      b.glow.scale.setScalar(0.5 + Math.sin(Math.min(p, 1) * Math.PI) * 3);
      b.glow.material.opacity = Math.max(0, 0.7 * (1 - p));
      b.energy.scale.setScalar(0.5 + p * 5);
      b.energy.rotation.y += dt;
      b.energy.material.opacity = 1 - p;
      for (const [j, h] of b.halos.entries()) {
        h.scale.setScalar(1 + p * (j ? 16 : 11));
        h.material.transparent = true;
        h.material.opacity = 1 - p;
      }
      for (let k = 0; k < b.positions.length; k += 3) {
        b.positions[k] = b.velocities[k] * b.age;
        b.positions[k + 1] = b.velocities[k + 1] * b.age - 0.8 * b.age * b.age;
        b.positions[k + 2] = b.velocities[k + 2] * b.age;
      }
      b.sparks.geometry.attributes.position.needsUpdate = true;
      b.sparks.material.opacity = 1 - p;
      if (p >= 1) {
        dispose(b.group);
        bursts.splice(i, 1);
      }
    }
    for (let i = announcements.length - 1; i >= 0; i--) {
      const a = announcements[i];
      a.age += dt;
      a.sprite.position.y += dt * 0.55;
      a.sprite.material.opacity = Math.min(1, (3 - a.age) / 0.5);
      if (a.age >= 3) {
        dispose(a.sprite);
        announcements.splice(i, 1);
      }
    }
  }
  return {
    professional(value) {
      professionalMode = value;
      robot.visible = !value;
      if (lastFrame) update(lastFrame, log, lastHistory);
    },
    selectStrategy(id) {
      activeStrategy = id;
      if (lastFrame) update(lastFrame, log, lastHistory);
    },
    bridgeScale(value) {
      scaleMode = value;
      if (lastFrame) update(lastFrame, log, lastHistory);
    },
    update,
    animate,
    burst,
    histories,
    interior(id) {
      activeStrategy = id;
      if (lastFrame) update(lastFrame, log, lastHistory);
      return {
        position: new T.Vector3(30, 5, -6),
        target: new T.Vector3(30, 2.5, -16),
      };
    },
    clear() {
      for (const b of bursts) dispose(b.group);
      bursts.length = 0;
      for (const a of announcements) dispose(a.sprite);
      announcements.length = 0;
    },
  };
}
