import test from "node:test";
import assert from "node:assert/strict";
import { cityLayout } from "../src/scene-layout.js";
test("cinematic skyline is reproducible, dense, and finite", () => {
  const layout = cityLayout();
  assert.deepEqual(layout, cityLayout());
  assert.equal(layout.landmarks.length, 5);
  assert.equal(layout.satellites.length, 3);
  assert.ok(layout.buildings.length >= 160);
  for (const b of layout.buildings) {
    for (const k of ["x", "y", "z", "width", "depth", "height"])
      assert.ok(Number.isFinite(b[k]));
    assert.ok(b.width > 0 && b.depth > 0 && b.height > 0);
  }
});
test("landmark centers have clear space within their city blocks", () => {
  const layout = cityLayout();
  for (const t of layout.landmarks)
    for (const b of layout.buildings) {
      if (b.district < 6) assert.ok(Math.hypot(t.x - b.x, t.z - b.z) > 1.5);
    }
});
