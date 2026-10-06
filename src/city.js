import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { STRATEGIES } from "./model.js";
export function createCity(host, onSelect) {
  const scene = new T.Scene();
  scene.background = new T.Color("#050912");
  scene.fog = new T.FogExp2("#050912", 0.011);
  const camera = new T.PerspectiveCamera(48, 1, 0.1, 180);
  camera.position.set(26, 23, 32);
  const renderer = new T.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 3, 0);
  controls.minDistance = 13;
  controls.maxDistance = 65;
  controls.maxPolarAngle = Math.PI * 0.47;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new T.Vector2(1, 1), 0.8, 0.5, 0.7));
  composer.addPass(new OutputPass());
  scene.add(new T.HemisphereLight(0x86ceff, 0x111324, 2));
  const light = new T.DirectionalLight(0x91baff, 3);
  light.position.set(10, 20, 10);
  scene.add(light);
  const cyan = 0x58e8ff,
    pink = 0xff4d94,
    amber = 0xffbd66,
    towers = new Map(),
    targets = [],
    effects = [];
  function mesh(geometry, color, glow = false) {
    return new T.Mesh(
      geometry,
      new T.MeshStandardMaterial({
        color,
        metalness: 0.6,
        roughness: 0.35,
        emissive: color,
        emissiveIntensity: glow ? 2 : 0.08,
      }),
    );
  }
  function ring(radius, y, color) {
    const m = mesh(new T.TorusGeometry(radius, 0.035, 8, 180), color, true);
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    scene.add(m);
    return m;
  }
  const platform = mesh(new T.CylinderGeometry(12, 10.8, 0.8, 96), 0x102335);
  platform.position.y = -0.45;
  scene.add(platform);
  const underside = mesh(new T.ConeGeometry(10.5, 3.5, 64), 0x091426);
  underside.rotation.z = Math.PI;
  underside.position.y = -2.6;
  scene.add(underside);
  [12, 11.5, 9.8, 4].forEach((r, i) =>
    ring(r, 0.06 + i * 0.01, i % 2 ? 0x4c67ff : cyan),
  );
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const m = mesh(new T.BoxGeometry(0.24, 0.09, 0.55), cyan, true);
    m.position.set(Math.cos(a) * 11.75, 0.15, Math.sin(a) * 11.75);
    m.rotation.y = -a;
    scene.add(m);
  }
  const grid = new T.GridHelper(23, 32, 0x195267, 0x102c40);
  grid.position.y = 0.025;
  scene.add(grid);
  function label(text, color = cyan) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#071624";
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 508, 92);
    ctx.fillStyle = "#d9f7ff";
    ctx.font = "bold 25px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 58);
    const texture = new T.CanvasTexture(c);
    const sprite = new T.Sprite(
      new T.SpriteMaterial({ map: texture, depthTest: false }),
    );
    sprite.scale.set(4.6, 0.86, 1);
    sprite.userData = { canvas: c, context: ctx, texture };
    return sprite;
  }
  const core = mesh(new T.CylinderGeometry(1.3, 1.8, 3, 12), cyan, true);
  core.position.y = 1.5;
  scene.add(core);
  const coreLabel = label("CME / EXCHANGE");
  coreLabel.position.set(0, 4, 0);
  scene.add(coreLabel);
  targets.push(core);
  core.userData.id = "exchange";
  function block(x, z, h, id, title, color = cyan) {
    const group = new T.Group();
    group.position.set(x, 0, z);
    scene.add(group);
    const base = mesh(new T.BoxGeometry(3, 0.22, 3), 0x1a344c);
    base.position.y = 0.15;
    group.add(base);
    const body = mesh(new T.BoxGeometry(1.45, h, 1.45), 0x15283f);
    body.position.y = h / 2 + 0.3;
    body.userData.id = id;
    group.add(body);
    targets.push(body);
    const edge = new T.LineSegments(
      new T.EdgesGeometry(body.geometry),
      new T.LineBasicMaterial({ color }),
    );
    body.add(edge);
    // A single instanced mesh per tower renders hundreds of illuminated windows.
    const windows = new T.InstancedMesh(
      new T.BoxGeometry(0.075, 0.11, 0.015),
      new T.MeshBasicMaterial({ color }),
      4 * 8 * 14,
    );
    let n = 0;
    const dummy = new T.Object3D();
    for (let side = 0; side < 4; side++)
      for (let row = 0; row < 14; row++)
        for (let col = 0; col < 8; col++) {
          dummy.position.set(
            (col - 3.5) * 0.15,
            ((row + 0.5) / 14) * h - h / 2,
            0.733,
          );
          dummy.rotation.set(0, 0, 0);
          if (side === 1) {
            dummy.position.z = -0.733;
          }
          if (side >= 2) {
            const a = dummy.position.x;
            dummy.position.x = side === 2 ? 0.733 : -0.733;
            dummy.position.z = a;
            dummy.rotation.y = Math.PI / 2;
          }
          dummy.updateMatrix();
          windows.setMatrixAt(n++, dummy.matrix);
        }
    body.add(windows);
    const beam = new T.Mesh(
      new T.CylinderGeometry(0.065, 0.24, 12, 12),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    beam.position.y = h + 6;
    group.add(beam);
    const cap = mesh(new T.TorusGeometry(1, 0.025, 8, 48), color, true);
    cap.rotation.x = Math.PI / 2;
    cap.position.y = h + 0.4;
    group.add(cap);
    const tag = label(title, color);
    tag.position.y = h + 2;
    group.add(tag);
    return { group, body, beam, cap, tag, h, color };
  }
  STRATEGIES.forEach((s, i) => {
    const a = (i / 5) * Math.PI * 2 - 0.3;
    towers.set(
      s.id,
      block(
        Math.cos(a) * 7.4,
        Math.sin(a) * 7.4,
        3.5 + i * 0.45,
        s.id,
        s.name.toUpperCase(),
      ),
    );
  });
  const nodes = {
    oms: new T.Vector3(-4, 1, 10),
    risk: new T.Vector3(0, 1, 10),
    gateway: new T.Vector3(4, 1, 10),
    exchange: new T.Vector3(0, 3, 0),
  };
  Object.entries(nodes)
    .filter(([id]) => id !== "exchange")
    .forEach(([id, p]) => block(p.x, p.z, 1.2, id, id.toUpperCase(), 0x9b9aff));
  const feedA = block(-6, -9, 1.5, "A", "MDP / FEED A"),
    feedB = block(-2, -10, 1.5, "B", "MDP / FEED B");
  function link(a, b, color) {
    const curve = new T.QuadraticBezierCurve3(
      a,
      a
        .clone()
        .lerp(b, 0.5)
        .add(new T.Vector3(0, 3, 0)),
      b,
    );
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(curve.getPoints(60)),
      new T.LineBasicMaterial({ color, transparent: true, opacity: 0.24 }),
    );
    scene.add(line);
    return curve;
  }
  towers.forEach((t) =>
    link(t.group.position.clone().add(new T.Vector3(0, 2, 0)), nodes.oms, cyan),
  );
  link(nodes.oms, nodes.risk, cyan);
  link(nodes.risk, nodes.gateway, cyan);
  link(nodes.gateway, nodes.exchange, cyan);
  link(new T.Vector3(-6, 2, -9), new T.Vector3(0, 3, 0), cyan);
  link(new T.Vector3(-2, 2, -10), new T.Vector3(0, 3, 0), cyan);
  let focus = null,
    disposed = false;
  const ray = new T.Raycaster(),
    mouse = new T.Vector2();
  let down;
  renderer.domElement.addEventListener(
    "pointerdown",
    (e) => (down = [e.clientX, e.clientY]),
  );
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5)
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) onSelect(hit.object.userData.id);
  });
  function clearEffects() {
    for (const e of effects) {
      scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
    }
    effects.length = 0;
  }
  function update(frame) {
    for (const s of frame.strategies) {
      const t = towers.get(s.id);
      const h = 3 + Math.min(Math.abs(s.pnl) / 1600, 4);
      t.body.scale.y = h / t.h;
      t.body.position.y = h / 2 + 0.3;
      t.cap.position.y = h + 0.4;
      t.beam.position.y = h + 6;
      t.tag.position.y = h + 2;
      const data = t.tag.userData;
      if (t.lastPnl !== s.pnl || t.lastPosition !== s.position) {
        const ctx = data.context;
        ctx.fillStyle = "#071624";
        ctx.fillRect(0, 0, 512, 96);
        ctx.strokeStyle = "#58e8ff";
        ctx.strokeRect(2, 2, 508, 92);
        ctx.fillStyle = "#d9f7ff";
        ctx.font = "bold 19px monospace";
        ctx.fillText(s.name.toUpperCase(), 256, 32);
        ctx.font = "24px monospace";
        ctx.fillStyle = s.pnl < 0 ? "#ff759f" : "#62efcf";
        ctx.fillText("$" + s.pnl.toFixed(0) + "   POS " + s.position, 256, 70);
        data.texture.needsUpdate = true;
        t.lastPnl = s.pnl;
        t.lastPosition = s.position;
      }
      const color = s.state === "DEGRADED" ? amber : s.pnl < 0 ? pink : cyan;
      t.beam.material.color.setHex(color);
      t.cap.material.color.setHex(color);
    }
    [feedA, feedB].forEach((t, i) =>
      t.beam.material.color.setHex(
        frame.feeds.find((f) => f.id === (i ? "B" : "A")).state === "HEALTHY"
          ? cyan
          : amber,
      ),
    );
  }
  function emit(event) {
    if (effects.length >= 80) return;
    const t = towers.get(event.strategyId);
    if (!t) return;
    let start, end;
    if (event.type === "ORDER_CREATED") {
      start = t.group.position.clone().add(new T.Vector3(0, 3, 0));
      end = nodes.oms;
    } else if (event.type === "RISK_PASSED" || event.type === "RISK_REJECTED") {
      start = nodes.oms;
      end = nodes.risk;
    } else if (event.type === "ORDER_SENT") {
      start = nodes.risk;
      end = nodes.gateway;
    } else if (event.type === "ORDER_ACK") {
      start = nodes.gateway;
      end = nodes.exchange;
    } else if (event.type === "FILL") {
      start = nodes.exchange;
      end = t.group.position.clone().add(new T.Vector3(0, 3, 0));
    } else return;
    const color =
      event.type === "RISK_REJECTED"
        ? pink
        : event.type === "FILL"
          ? 0x65ffd0
          : cyan;
    const m = mesh(new T.SphereGeometry(0.13, 8, 8), color, true);
    scene.add(m);
    effects.push({
      mesh: m,
      curve: new T.QuadraticBezierCurve3(
        start,
        start
          .clone()
          .lerp(end, 0.5)
          .add(new T.Vector3(0, 4, 0)),
        end,
      ),
      age: 0,
      delay:
        [
          "ORDER_CREATED",
          "RISK_PASSED",
          "ORDER_SENT",
          "ORDER_ACK",
          "FILL",
        ].indexOf(event.type) * 0.18,
    });
  }
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();
  const clock = new T.Clock();
  let raf;
  function animate() {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    core.rotation.y += dt * 0.18;
    if (focus) {
      controls.target.lerp(focus, 0.06);
      if (controls.target.distanceTo(focus) < 0.02) focus = null;
    }
    controls.update();
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      const t = (e.age - e.delay) / 1.3;
      e.mesh.visible = t >= 0;
      if (t >= 0) e.mesh.position.copy(e.curve.getPoint(Math.min(t, 1)));
      if (t >= 1) {
        scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        effects.splice(i, 1);
      }
    }
    composer.render();
  }
  animate();
  return {
    update,
    emit,
    clearEffects,
    focus(id) {
      const t = towers.get(id);
      if (t) focus = t.group.position.clone().add(new T.Vector3(0, 3, 0));
    },
    home() {
      camera.position.set(26, 23, 32);
      focus = new T.Vector3(0, 3, 0);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      controls.dispose();
      clearEffects();
      scene.traverse((o) => {
        o.geometry?.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => {
          m?.map?.dispose();
          m?.dispose();
        });
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
