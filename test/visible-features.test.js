import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import * as T from "three";
import { createPnlBridge, pnlBridgePoints } from "../src/pnl-bridge.js";
import { createWindows } from "../src/windows.js";
import { createApp } from "../server/app.js";

test("P&L bridge plots observed aggregate values on the actual time axis", () => {
  const frames = [
    { time: 1, strategies: [{ pnl: -5 }, { pnl: 1 }] },
    { time: 3, strategies: [{ pnl: 4 }, { pnl: 4 }] },
    { time: 9, strategies: [{ pnl: 0 }, { pnl: 0 }] },
  ];
  const points = pnlBridgePoints(frames);
  assert.equal(points[0].x, -13);
  assert.equal(points[1].x, -6.5);
  assert.equal(points[2].x, 13);
  assert.equal(points[0].y, 3.5);
  assert.equal(points[1].y, 9.5);
  assert.equal(points[2].y, 5.5);
});
test("P&L bridge handles empty, flat, single and bounded history", () => {
  assert.deepEqual(pnlBridgePoints([]), []);
  const frames = Array.from({ length: 300 }, (_, time) => ({
    time,
    strategies: [{ pnl: 0 }],
  }));
  assert.equal(pnlBridgePoints(frames).length, 240);
  for (const p of pnlBridgePoints(frames.slice(0, 1)))
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("detail cards drag, detach, update and enforce the six-window bound", () => {
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.style = {};
      this.innerHTML = "";
      this.textContent = "";
    }
    setAttribute() {}
    append(...items) {
      for (const i of items) {
        i.parent = this;
        this.children.push(i);
      }
    }
    remove() {
      this.parent.children = this.parent.children.filter((i) => i !== this);
    }
    closest(tag) {
      return this.tag === tag ? this : null;
    }
    getBoundingClientRect() {
      return {
        left: parseFloat(this.style.left),
        top: parseFloat(this.style.top),
      };
    }
    setPointerCapture() {}
    querySelectorAll() {
      return [];
    }
    cloneNode() {
      const e = new Element(this.tag);
      e.innerHTML = this.innerHTML;
      return e;
    }
    replaceChildren(...items) {
      this.children = items;
    }
  }
  const old = {
    document: globalThis.document,
    window: globalThis.window,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  const headings = new Element("h1"),
    main = new Element("main");
  const external = {
    closed: false,
    document: {
      write() {},
      close() {},
      querySelector: (q) => (q === "h1" ? headings : main),
    },
  };
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    addEventListener() {},
  };
  globalThis.window = { open: () => external };
  globalThis.innerWidth = 1400;
  globalThis.innerHeight = 900;
  try {
    const host = new Element("div"),
      windows = createWindows(host);
    windows.open("mm", "Strategy mm", "P&L 12");
    const element = host.children[0],
      bar = element.children[0],
      body = element.children[1];
    bar.onpointerdown({
      target: bar,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    bar.onpointermove({ clientX: 140, clientY: 120 });
    bar.onpointerup();
    assert.equal(element.style.top, "240px");
    assert.equal(element.style.left, "1050px");
    bar.children[1].onclick();
    assert.equal(headings.textContent, "Strategy mm");
    assert.equal(main.children[0].innerHTML, "P&L 12");
    windows.update("mm", "P&L 20");
    windows.syncPopouts();
    assert.equal(main.children[0].innerHTML, "P&L 20");
    for (let i = 0; i < 7; i++)
      windows.open("card-" + i, "Card " + i, "Details");
    assert.equal(host.children.length, 6);
    assert.equal(windows.has("mm"), false);
    windows.clear();
    assert.equal(host.children.length, 0);
  } finally {
    Object.assign(globalThis, old);
  }
});

test("served release includes visible controls and forces HTML revalidation", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "nexus-visible-"));
  const app = createApp({ dataDir, token: "test-token-01234567890123456789" });
  try {
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const response = await fetch(
      "http://127.0.0.1:" + app.server.address().port + "/",
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const html = await response.text();
    assert.ok(html.includes("v8.0.0"));
    for (const id of [
      "show-details",
      "show-prices",
      "show-signals",
      "show-pnl",
      "ticker",
      "visible-price-chart",
      "visible-signal",
      "city-navigation",
      "ticker-pause",
      "ticker-viewport",
    ])
      assert.ok(html.includes('id="' + id + '"'), id);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("P&L bridge geometry grows and shrinks without truncating the replay graph", () => {
  const scene = new T.Scene(),
    targets = [];
  const bridge = createPnlBridge(scene, targets),
    graph = scene.children[0].children.find(
      (o) => o.isLine && !o.isLineSegments,
    );
  const frames = Array.from({ length: 300 }, (_, time) => ({
    time,
    strategies: [{ pnl: time }],
  }));
  bridge.update(frames.slice(0, 1));
  assert.equal(graph.geometry.drawRange.count, 1);
  bridge.update(frames);
  assert.equal(graph.geometry.drawRange.count, 240);
  assert.equal(graph.geometry.attributes.position.getX(239), 13);
  bridge.update(frames.slice(0, 4));
  assert.equal(graph.geometry.drawRange.count, 4);
  bridge.update([]);
  assert.equal(graph.geometry.drawRange.count, 0);
});

test("aggregate bridge zero reference uses aggregate P&L bounds", () => {
  const scene = new T.Scene();
  const bridge = createPnlBridge(scene, []);
  bridge.update([{ time: 1, strategies: [{ pnl: -100 }, { pnl: 200 }] }]);
  const lines = bridge.group.children.filter((o) => o.isLine && !o.isLineSegments);
  assert.equal(lines[0].geometry.attributes.position.getY(0), 9.5);
  assert.equal(lines[1].geometry.attributes.position.getY(0), 3.5);
});
