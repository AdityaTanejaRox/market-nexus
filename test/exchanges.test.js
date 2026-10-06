import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {
  EXCHANGES,
  exchangeOf,
  exchangeTotals,
  stateLayout,
} from "../src/exchanges.js";
import { generateSession, validateFrame } from "../src/model.js";
import { pnlBridgePoints } from "../src/pnl-bridge.js";
import { createCityExtras } from "../src/city-extras.js";

test("demo has two strategies per exchange and fits import/ingestion limits", () => {
  const session = generateSession(42, 600),
    cities = exchangeTotals(session.frames[30].strategies);
  for (const e of cities.filter((e) => e.id !== "UNASSIGNED"))
    assert.equal(e.strategies.length, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(session)) < 25 * 1024 * 1024);
  assert.ok(
    session.frames.every(
      (f) => Buffer.byteLength(JSON.stringify(f)) < 128 * 1024,
    ),
  );
});
test("dynamic strategy IDs and explicit exchange identity validate without symbol guessing", () => {
  const frame = generateSession(1, 0).frames[0];
  frame.strategies = [
    {
      ...frame.strategies[0],
      id: "new_strategy",
      exchange: "NYSE",
      symbol: "ES",
    },
  ];
  validateFrame(frame);
  assert.equal(exchangeOf(frame.strategies[0]), "NYSE");
  delete frame.strategies[0].exchange;
  validateFrame(frame);
  assert.equal(exchangeOf(frame.strategies[0]), "UNASSIGNED");
  frame.strategies[0].exchange = "unknown";
  assert.throws(() => validateFrame(frame));
  frame.strategies[0].exchange = "CME";
  frame.strategies[0].id = "bad-id";
  assert.throws(() => validateFrame(frame));
  frame.strategies = [];
  assert.throws(() => validateFrame(frame));
});
test("tower districts group multiple strategies per city and use stable ID ordering", () => {
  const strategies = generateSession(1, 0).frames[0].strategies;
  strategies[0].exchange = "NYSE";
  const layout = stateLayout(strategies),
    reverse = stateLayout([...strategies].reverse());
  assert.deepEqual(
    layout.map((e) => e.towers),
    reverse.map((e) => e.towers),
  );
  assert.equal(layout.find((e) => e.id === "NYSE").towers.length, 3);
  for (const city of layout)
    for (const t of city.towers) {
      assert.equal(t.exchange, city.id);
      assert.ok(Math.hypot(t.x - city.x, t.z - city.z) < 14);
    }
});
test("per-strategy bridges preserve opposite P&L and skip absent-strategy frames", () => {
  const frames = [
    {
      time: 0,
      strategies: [
        { id: "a", pnl: 0 },
        { id: "b", pnl: 0 },
      ],
    },
    {
      time: 1,
      strategies: [
        { id: "a", pnl: 10 },
        { id: "b", pnl: -10 },
      ],
    },
    { time: 2, strategies: [{ id: "b", pnl: -20 }] },
  ];
  const a = pnlBridgePoints(frames, "a"),
    b = pnlBridgePoints(frames, "b");
  assert.equal(a.length, 2);
  assert.equal(a[1].y, 9.5);
  assert.equal(b.at(-1).y, 3.5);
  assert.ok(b[0].y > b[1].y);
  assert.equal(pnlBridgePoints(frames, "missing").length, 0);
});
test("city displays create per-strategy bridges and clean raycast targets when a fleet disappears", () => {
  const scene = new T.Scene(),
    targets = [],
    towers = new Map();
  const context = new Proxy(
    {},
    { get: (o, k) => o[k] ?? (() => {}), set: (o, k, v) => ((o[k] = v), true) },
  );
  const canvasSprite = (width, height, scale) => {
    const s = new T.Sprite(new T.SpriteMaterial({ map: new T.Texture() }));
    s.scale.set(scale, (scale * height) / width, 1);
    s.userData = {
      canvas: { width, height },
      context,
      texture: s.material.map,
    };
    return s;
  };
  const add = (g, m, p, parent = scene) => {
    const object = new T.Mesh(g, m);
    object.position.copy(p);
    parent.add(object);
    return object;
  };
  const neon = (color) => new T.MeshBasicMaterial({ color });
  const ring = (r, y, c, parent = scene, t = 0.035) =>
    add(
      new T.TorusGeometry(r, t, 6, 12),
      neon(c),
      new T.Vector3(0, y, 0),
      parent,
    );
  const billboard = (title, rows, pos, scale) => {
    const s = canvasSprite(440, 156, scale);
    s.position.copy(pos);
    scene.add(s);
    return s;
  };
  const extras = createCityExtras({
    scene,
    towers,
    targets,
    canvasSprite,
    textPanel() {},
    billboard,
    add,
    neon,
    ring,
  });
  const baseline = targets.length,
    frame = generateSession(1, 1).frames[1];
  for (const s of frame.strategies) {
    const group = new T.Group();
    scene.add(group);
    towers.set(s.id, { group, index: 0 });
  }
  extras.update(frame, [], [frame]);
  const ids = new Set(targets.map((t) => t.userData.id));
  for (const s of frame.strategies) assert.ok(ids.has("pnl-bridge-" + s.id));
  extras.update({ ...frame, strategies: [] }, [], []);
  assert.equal(targets.length, baseline);
});
