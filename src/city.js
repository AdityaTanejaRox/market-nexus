import * as T from "three";
import { createCityExtras, hovercar } from "./city-extras.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { EXCHANGES, stateLayout, exchangeOf } from "./exchanges.js";
import { cityLayout } from "./scene-layout.js";

export function createCity(host, onSelect, onOrder = () => {}) {
  const scene = new T.Scene();
  scene.background = new T.Color("#040315");
  scene.fog = new T.FogExp2("#080726", 0.0025);
  const camera = new T.PerspectiveCamera(49, 1, 0.1, 600);
  const homePosition = new T.Vector3(90, 90, 120),
    homeTarget = new T.Vector3(0, 5, 0);
  camera.position.copy(homePosition);
  const renderer = new T.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  host.appendChild(renderer.domElement);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.target.copy(homeTarget);
  orbit.minDistance = 10;
  orbit.maxDistance = 260;
  orbit.maxPolarAngle = Math.PI * 0.49;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new T.Vector2(1, 1), 1.05, 0.65, 0.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  scene.add(new T.HemisphereLight(0x8b9aff, 0x100421, 1.8));
  const key = new T.DirectionalLight(0x91adff, 2.8);
  key.position.set(10, 30, 20);
  scene.add(key);
  const wash = new T.PointLight(0x3535ff, 220, 70, 2);
  wash.position.set(0, 8, 0);
  scene.add(wash);
  const cyan = 0x38eeff,
    pink = 0xff3caf,
    gold = 0xffd48b,
    violet = 0x8461ff;
  const layout = cityLayout(),
    towers = new Map(),
    targets = [],
    rings = [],
    beacons = [],
    flows = [],
    effects = [];
  let professionalMode = true,
    autoFocus = false,
    selectedStrategy = "mm";
  const originalMaterials = new WeakMap();
  let tour = false,
    disposed = false,
    flight = null;
  let following = null,
    followQueue = [],
    followTimer = 0,
    lastFrame = null,
    lastHealth = {};
  const material = (color, emission = 0) =>
    new T.MeshStandardMaterial({
      color,
      metalness: 0.7,
      roughness: 0.32,
      emissive: color,
      emissiveIntensity: emission,
    });
  const neon = (color, opacity = 1) =>
    new T.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity === 1,
      toneMapped: false,
    });
  function add(geometry, mat, position, parent = scene) {
    const m = new T.Mesh(geometry, mat);
    if (position) m.position.copy(position);
    parent.add(m);
    return m;
  }
  function ring(radius, y, color, parent = scene, thickness = 0.035) {
    const m = add(
      new T.TorusGeometry(radius, thickness, 6, 96),
      neon(color),
      new T.Vector3(0, y, 0),
      parent,
    );
    m.rotation.x = Math.PI / 2;
    m.userData.ornament = true;
    return m;
  }
  function lines(points, color, parent = scene, opacity = 0.4) {
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(points),
      new T.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        toneMapped: false,
      }),
    );
    parent.add(line);
    return line;
  }
  function edges(mesh, color = 0x6179b8) {
    mesh.add(
      new T.LineSegments(
        new T.EdgesGeometry(mesh.geometry),
        new T.LineBasicMaterial({ color, transparent: true, opacity: 0.4 }),
      ),
    );
  }
  function canvasSprite(width, height, scale) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(
      new T.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    sprite.scale.set(scale, (scale * height) / width, 1);
    sprite.userData = { canvas, context, texture };
    return sprite;
  }
  function textPanel(sprite, title, rows, color = "#64eeff", history = []) {
    const { canvas: c, context: x, texture } = sprite.userData;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = professionalMode ? "rgba(27,36,47,.96)" : "rgba(3,7,27,.90)";
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = professionalMode ? "#627588" : color;
    x.lineWidth = 2;
    x.strokeRect(2, 2, c.width - 4, c.height - 4);
    x.fillStyle = professionalMode ? "#adc0cf" : color;
    x.fillRect(0, 0, 5, c.height);
    x.textAlign = "left";
    x.font = "bold 21px monospace";
    x.fillText(title.toUpperCase().slice(0, 30), 20, 34);
    x.fillStyle = "#e5efff";
    rows.forEach((row, i) => {
      x.font = i === 0 ? "bold 30px monospace" : "17px monospace";
      x.fillText(row, 20, 76 + i * 26);
    });
    if (history.length > 1) {
      const low = Math.min(...history),
        high = Math.max(...history),
        range = high - low || 1;
      x.strokeStyle = color;
      x.lineWidth = 2;
      x.beginPath();
      history.forEach((v, i) => {
        const px = 20 + (i / (history.length - 1)) * (c.width - 40),
          py = c.height - 22 - ((v - low) / range) * 45;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      });
      x.stroke();
    }
    texture.needsUpdate = true;
  }
  function billboard(title, rows, position, scale = 4.4, color = "#64eeff") {
    const s = canvasSprite(440, 156, scale);
    textPanel(s, title, rows, color);
    s.position.copy(position);
    scene.add(s);
    return s;
  }
  // Reusable illuminated facade. Instancing keeps the surrounding skyline to one draw call.
  const facade = new T.ShaderMaterial({
    toneMapped: false,
    uniforms: { uProfessional: { value: 1 } },
    vertexShader: `
    attribute vec3 aSize; varying vec2 vUv; varying vec3 vSize; varying vec3 vNormal;
    void main(){vUv=uv;vSize=aSize;vNormal=normal;vec4 p=vec4(position,1.0);
    #ifdef USE_INSTANCING
      p=instanceMatrix*p;
    #endif
    gl_Position=projectionMatrix*modelViewMatrix*p;}`,
    fragmentShader: `
    uniform float uProfessional; varying vec2 vUv; varying vec3 vSize; varying vec3 vNormal;
    void main(){bool roof=abs(vNormal.y)>.5;float faceWidth=abs(vNormal.z)>.5?vSize.x:vSize.z;
      vec2 cells=vUv*vec2(faceWidth*7.0,vSize.y*5.0);vec2 grid=fract(cells);
      float seed=fract(sin(dot(floor(cells),vec2(12.9898,78.233)))*43758.5453);
      float lit=step(.20,grid.x)*step(grid.x,.70)*step(.2,grid.y)*step(grid.y,.62)*step(.27,seed);
      vec3 base=vec3(.015,.025,.10);vec3 window=mix(vec3(.24,.38,.85),vec3(.75,.85,1.0),seed);
      vec2 edge=min(vUv,1.0-vUv);float trim=1.0-step(.012,min(edge.x,edge.y));
      vec3 classic=roof?vec3(.035,.035,.12):base+window*lit*.8+vec3(.10,.17,.40)*trim;
      vec3 operational=roof?vec3(.30,.35,.40):vec3(.19,.24,.29)+vec3(.10,.13,.15)*lit+vec3(.10)*trim;
      gl_FragColor=vec4(mix(classic,operational,uProfessional),1.0);}`,
  });
  function urbanBuildings(specs, parent = scene) {
    const geometry = new T.BoxGeometry(1, 1, 1);
    geometry.setAttribute(
      "aSize",
      new T.InstancedBufferAttribute(
        new Float32Array(specs.flatMap((b) => [b.width, b.height, b.depth])),
        3,
      ),
    );
    const mesh = new T.InstancedMesh(geometry, facade, specs.length);
    const dummy = new T.Object3D();
    specs.forEach((b, i) => {
      dummy.position.set(b.x, b.y + b.height / 2, b.z);
      dummy.scale.set(b.width, b.height, b.depth);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.computeBoundingSphere();
    parent.add(mesh);
    return mesh;
  }
  urbanBuildings(layout.buildings);
  // Layered floating foundation, exposed ribs, energy decks and perimeter promenades.
  const deck = add(
    new T.CylinderGeometry(17, 16.6, 0.8, 128),
    material(0x161347, 0.22),
    new T.Vector3(0, -0.45, 0),
  );
  add(
    new T.CylinderGeometry(15.7, 13.3, 1.4, 64),
    material(0x080c24),
    new T.Vector3(0, -1.55, 0),
  );
  add(
    new T.CylinderGeometry(13.3, 7, 1.6, 64),
    material(0x0e0b28),
    new T.Vector3(0, -3, 0),
  );
  add(
    new T.CylinderGeometry(7, 2.2, 1, 32),
    material(0x131339),
    new T.Vector3(0, -4.2, 0),
  );
  [17, 16.4, 15.4, 8, 4.1].forEach((r, i) =>
    ring(r, 0.05 + i * 0.025, i % 2 ? violet : cyan),
  );
  ring(16.1, -1.1, violet);
  ring(13.1, -2.9, cyan);
  ring(7, -3.8, violet);
  ring(2.25, -4.8, cyan);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const rim = add(
      new T.BoxGeometry(0.19, 0.14, 0.65),
      neon(i % 4 ? 0x628dff : 0xaef5ff),
      new T.Vector3(Math.cos(a) * 16.75, 0.16, Math.sin(a) * 16.75),
    );
    rim.rotation.y = -a;
    const rib = add(
      new T.BoxGeometry(0.13, 1.2, 0.3),
      material(0x344576),
      new T.Vector3(Math.cos(a) * 15.2, -1.7, Math.sin(a) * 15.2),
    );
    rib.rotation.y = -a;
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lines(
      [
        new T.Vector3(Math.cos(a) * 4, 0.035, Math.sin(a) * 4),
        new T.Vector3(Math.cos(a) * 16, 0.035, Math.sin(a) * 16),
      ],
      0x6272f8,
      scene,
      0.45,
    );
  }
  const promenade = ring(16.7, 2.1, 0x7f99ff);
  ring(16.7, 1.8, 0x4250a0);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    add(
      new T.CylinderGeometry(0.025, 0.025, 2, 4),
      material(0x34436e),
      new T.Vector3(Math.cos(a) * 16.7, 1, Math.sin(a) * 16.7),
    );
  }
  // Central exchange: a luminous vault under an orbital armillary.
  const coreGroup = new T.Group();
  scene.add(coreGroup);
  const core = add(
    new T.CylinderGeometry(2.2, 2.6, 1.8, 20),
    material(0x53452a, 0.3),
    new T.Vector3(0, 0.9, 0),
    coreGroup,
  );
  edges(core, gold);
  core.userData.id = "exchange";
  targets.push(core);
  add(
    new T.SphereGeometry(1.95, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    neon(0xffe6b8),
    new T.Vector3(0, 1.9, 0),
    coreGroup,
  );
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    add(
      new T.BoxGeometry(0.065, 1.8, 0.08),
      neon(gold),
      new T.Vector3(Math.cos(a) * 2.23, 0.9, Math.sin(a) * 2.23),
      coreGroup,
    );
  }
  ring(2.6, 0.08, gold);
  ring(2.8, 0.2, cyan);
  const vaultPanel = billboard(
    "MARKET NEXUS STATE",
    ["Waiting for telemetry", "Exchange cities / strategy towers"],
    new T.Vector3(0, 5, 1),
    5.4,
    "#ffdda0",
  );
  const orbital = new T.Group();
  orbital.position.y = 6.3;
  scene.add(orbital);
  for (let i = 0; i < 3; i++) {
    const r = ring(1.4 + i * 0.2, 0, i === 1 ? gold : cyan, orbital);
    r.rotation.x = 0.3 + i * 0.75;
    r.rotation.z = i * 0.8;
  }
  rings.push({ object: orbital, speed: 0.3, axis: "y" });
  // Each strategy is a tiered skyscraper and its own compact city block.
  function landmark(spec, id, name, index) {
    const group = new T.Group();
    group.position.set(spec.x, 0.22, spec.z);
    scene.add(group);
    add(
      new T.BoxGeometry(5.5, 0.25, 5.5),
      material(0x111a43, 0.2),
      new T.Vector3(0, 0, 0),
      group,
    );
    const pad = ring(2.9, 0.16, index === 2 ? pink : cyan, group);
    pad.rotation.z = 0.15;
    const skyline = new T.Group();
    group.add(skyline);
    const sizes = [
      { w: 2.05, h: 3.2, d: 1.9, y: 1.85 },
      { w: 1.55, h: 2.8, d: 1.4, y: 4.85 },
      { w: 0.95, h: 2.4, d: 0.85, y: 7.45 },
    ];
    const bodies = [];
    sizes.forEach((tier, i) => {
      const m = urbanBuildings(
        [
          {
            x: 0,
            z: 0,
            y: tier.y - tier.h / 2,
            width: tier.w,
            height: tier.h,
            depth: tier.d,
          },
        ],
        skyline,
      );
      m.userData.id = id;
      targets.push(m);
      bodies.push(m);
      const lip = add(
        new T.BoxGeometry(tier.w + 0.25, 0.12, tier.d + 0.25),
        material(0x2e3364, 0.3),
        new T.Vector3(0, tier.y + tier.h / 2, 0),
        skyline,
      );
      edges(lip, index === 2 ? pink : cyan);
    });
    add(
      new T.CylinderGeometry(0.055, 0.1, 3, 8),
      neon(cyan),
      new T.Vector3(0, 10, 0),
      skyline,
    );
    const healthBadge = add(
      new T.SphereGeometry(0.22, 12, 8),
      neon(0x7396b0),
      new T.Vector3(0, 10, 0),
      group,
    );
    healthBadge.userData.semantic = true;
    const crown = new T.Group();
    crown.position.y = 9;
    group.add(crown);
    for (let i = 0; i < 3; i++) {
      const r = ring(
        0.7 + i * 0.24,
        i * 0.32,
        index === 2 ? pink : cyan,
        crown,
        0.02,
      );
      r.rotation.z = 0.1 * i;
      rings.push({
        object: r,
        speed: (i % 2 ? -1 : 1) * (0.3 + i * 0.1),
        axis: "z",
      });
    }
    const beamGroup = new T.Group();
    beamGroup.position.y = 9.8;
    group.add(beamGroup);
    const beam = add(
      new T.CylinderGeometry(0.07, 0.16, 21, 12),
      neon(cyan, 0.6),
      new T.Vector3(0, 10.5, 0),
      beamGroup,
    );
    add(
      new T.CylinderGeometry(0.23, 0.35, 21, 12),
      neon(cyan, 0.055),
      new T.Vector3(0, 10.5, 0),
      beamGroup,
    );
    const tag = canvasSprite(440, 210, 4.7);
    tag.position.set(0, 12.5, 0);
    group.add(tag);
    textPanel(tag, name, ["Waiting for data", "No measured activity"]);
    const badge = billboard(
      name,
      ["STRATEGY NODE " + (index + 1)],
      new T.Vector3(spec.x, 1, spec.z + 2.7),
      2.3,
    );
    const selection = ring(3.1, 0.3, gold, group, 0.06);
    selection.visible = false;
    return {
      group,
      healthBadge,
      skyline,
      crown,
      beamGroup,
      beam,
      tag,
      badge,
      selection,
      history: [],
      lastSeq: -1,
      baseHeight: spec.height,
      index,
    };
  }
  const cityPanels = new Map(),
    cityBases = new Map();
  for (const venue of EXCHANGES) {
    const group = new T.Group();
    group.position.set(venue.x, 0, venue.z);
    scene.add(group);
    const base = add(
      new T.CylinderGeometry(14, 12, 1.2, 64),
      material(0x152448, 0.3),
      new T.Vector3(0, -0.7, 0),
      group,
    );
    base.userData.id = "city-" + venue.id;
    targets.push(base);
    cityBases.set(venue.id, base);
    ring(14, 0.05, venue.color, group, 0.08);
    ring(12, -1.2, venue.color, group, 0.06);
    const buildings = [];
    for (let i = 0; i < 64; i++) {
      const a = (i * Math.PI * 2) / 64,
        r = 11.7 + (i % 3) * 0.45;
      buildings.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        y: 0,
        width: 0.4 + (i % 3) * 0.12,
        depth: 0.5,
        height: 1 + (i % 7) * 0.32,
      });
    }
    urbanBuildings(buildings, group);
    const hub = add(
      new T.CylinderGeometry(1.2, 1.5, 2.2, 12),
      material(venue.color, 0.3),
      new T.Vector3(0, 1, 0),
      group,
    );
    hub.userData.id = "city-" + venue.id;
    targets.push(hub);
    const panel = billboard(
      venue.id + " CITY",
      ["Waiting for source strategies"],
      new T.Vector3(venue.x, 16, venue.z),
      9,
      "#" + venue.color.toString(16),
    );
    panel.userData.id = "city-" + venue.id;
    targets.push(panel);
    cityPanels.set(venue.id, panel);
    // Long illuminated state highways join the cities to the central services.
    lines(
      [
        new T.Vector3(venue.x, 0, venue.z),
        new T.Vector3(venue.x * 0.55, 1, venue.z * 0.55),
        new T.Vector3(0, 0, 0),
      ],
      venue.color,
      scene,
      0.3,
    );
  }
  function removeTower(t) {
    const removed = new Set();
    t.group.traverse((o) => removed.add(o));
    removed.add(t.badge);
    for (let i = targets.length - 1; i >= 0; i--)
      if (removed.has(targets[i])) targets.splice(i, 1);
    for (let i = rings.length - 1; i >= 0; i--)
      if (removed.has(rings[i].object)) rings.splice(i, 1);
    t.group.parent?.remove(t.group);
    t.badge.parent?.remove(t.badge);
    for (const o of removed) {
      o.geometry?.dispose();
      if (o.material && o.material !== facade) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    }
  }
  function syncCities(frame) {
    const active = new Set(frame.strategies.map((s) => s.id));
    for (const [id, t] of towers)
      if (!active.has(id)) {
        removeTower(t);
        towers.delete(id);
      }
    for (const city of stateLayout(frame.strategies)) {
      const radius = Math.max(
        14,
        5.5 + Math.floor(Math.max(0, city.strategies.length - 1) / 8) * 3 + 3,
      );
      cityBases.get(city.id).scale.set(radius / 14, 1, radius / 14);
      textPanel(
        cityPanels.get(city.id),
        city.id + " CITY",
        [
          city.strategies.length + " STRATEGY TOWERS",
          (city.pnl < 0 ? "-" : "+") + "$" + Math.abs(city.pnl).toFixed(0),
          frame.source?.toUpperCase() || "IMPORTED",
        ],
        "#" + city.color.toString(16),
      );
      for (const spec of city.towers) {
        const strategy = frame.strategies.find((s) => s.id === spec.id);
        if (!towers.has(spec.id))
          towers.set(
            spec.id,
            landmark(spec, spec.id, strategy.name, spec.index),
          );
        const t = towers.get(spec.id);
        t.group.position.set(spec.x, 0.22, spec.z);
        t.badge.position.set(spec.x, 1, spec.z + 2.7);
        t.exchange = city.id;
      }
    }
  }
  // Separate floating feed/execution islands with luminous suspension bridges.
  const feedBeams = new Map(),
    nodes = {
      exchange: new T.Vector3(0, 3, 0),
      oms: new T.Vector3(-5, 2, 13),
      risk: new T.Vector3(0, 2, 14),
      gateway: new T.Vector3(21, 2, 9),
    };
  function bridge(a, b, color) {
    const midpoint = a.clone().lerp(b, 0.5);
    midpoint.y -= 1;
    const curve = new T.QuadraticBezierCurve3(a, midpoint, b);
    const path = curve.getPoints(60);
    lines(path, color, scene, 0.6);
    const second = path.map((p) => p.clone().add(new T.Vector3(0, -0.35, 0)));
    lines(second, violet, scene, 0.35);
    return curve;
  }
  for (const satellite of layout.satellites) {
    const { x, z, y, r, id } = satellite;
    const group = new T.Group();
    group.position.set(x, y, z);
    scene.add(group);
    add(
      new T.CylinderGeometry(r, r * 0.85, 0.7, 48),
      material(0x161341, 0.25),
      new T.Vector3(0, -0.35, 0),
      group,
    );
    add(
      new T.CylinderGeometry(r * 0.82, 0.7, 1.5, 32),
      material(0x11132e),
      new T.Vector3(0, -1.4, 0),
      group,
    );
    ring(r, 0.02, cyan, group);
    ring(r - 0.2, 0.04, violet, group);
    const antenna = add(
      new T.CylinderGeometry(0.25, 0.45, 5, 12),
      material(0x2d3764, 0.3),
      new T.Vector3(0, 2.5, 0),
      group,
    );
    antenna.userData.id = id;
    targets.push(antenna);
    const halo = ring(1, 4.5, cyan, group);
    rings.push({ object: halo, speed: 0.3, axis: "z" });
    const beam = add(
      new T.CylinderGeometry(0.04, 0.12, 13, 8),
      neon(cyan, 0.4),
      new T.Vector3(0, 11, 0),
      group,
    );
    feedBeams.set(id, beam);
    const tag = billboard(
      id === "gateway" ? "ORDER GATEWAY" : "MDP / FEED " + id,
      ["Awaiting snapshot"],
      new T.Vector3(x, y + 7, z),
      4.2,
    );
    beacons.push({ id, tag });
    bridge(
      new T.Vector3(x, y + 0.3, z),
      new T.Vector3(x * 0.66, 0.2, z * 0.66),
      cyan,
    );
    if (id !== "gateway") nodes[id] = new T.Vector3(x, y + 4, z);
  }
  for (const [id, p] of Object.entries(nodes).filter(
    ([id]) => id === "oms" || id === "risk",
  )) {
    const body = add(
      new T.CylinderGeometry(0.8, 1.3, 2, 6),
      material(0x29234b, 0.4),
      p.clone().add(new T.Vector3(0, -1, 0)),
    );
    body.userData.id = id;
    targets.push(body);

    billboard(
      id,
      ["EXECUTION PIPELINE"],
      p.clone().add(new T.Vector3(0, 2, 0)),
      2.8,
      "#b8a4ff",
    );
  }
  // Architectural routes glow constantly; moving order trails exist only for observed events.
  function route(a, b, color, lift = 5) {
    const curve = new T.QuadraticBezierCurve3(
      a,
      a
        .clone()
        .lerp(b, 0.5)
        .add(new T.Vector3(0, lift, 0)),
      b,
    );
    lines(curve.getPoints(72), color, scene, 0.2);
    return curve;
  }
  towers.forEach((t) =>
    route(
      t.group.position.clone().add(new T.Vector3(0, 5, 0)),
      nodes.exchange,
      cyan,
      7,
    ),
  );
  route(nodes.A, nodes.exchange, cyan, 6);
  route(nodes.B, nodes.exchange, violet, 8);
  route(nodes.oms, nodes.risk, violet, 2);
  route(nodes.risk, nodes.gateway, violet, 5);
  // Decorative orbital traffic is intentionally distinct from telemetry-driven order effects.
  for (let i = 0; i < 7; i++) {
    const points = [];
    for (let j = 0; j <= 140; j++) {
      const a = (j / 140) * Math.PI * 2;
      points.push(
        new T.Vector3(
          Math.cos(a) * (18 + i * 0.8),
          3 + i * 0.55,
          Math.sin(a) * (18 + i * 0.8),
        ),
      );
    }
    const curve = new T.CatmullRomCurve3(points, true);
    lines(points, i % 2 ? violet : cyan, scene, 0.07);
    const bead = hovercar(i);
    scene.add(bead);
    targets.push(bead.userData.hull);
    flows.push({ curve, bead, phase: i * 0.137, speed: 0.012 + i * 0.002 });
  }
  const extras = createCityExtras({
    scene,
    towers,
    targets,
    canvasSprite,
    textPanel,
    billboard,
    add,
    neon,
    ring,
  });
  // Nebula dust and distant starfield, rendered as two point clouds.
  const dotCanvas = document.createElement("canvas");
  dotCanvas.width = 32;
  dotCanvas.height = 32;
  const ctx = dotCanvas.getContext("2d");
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "white");
  gradient.addColorStop(0.18, "rgba(150,200,255,.8)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const dotTexture = new T.CanvasTexture(dotCanvas);
  const stars = new Float32Array(1800 * 3);
  let rng = 17;
  const random = () =>
    (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 1800; i++) {
    const a = random() * Math.PI * 2,
      r = 65 + random() * 110;
    stars[i * 3] = Math.cos(a) * r;
    stars[i * 3 + 1] = (random() - 0.35) * 95;
    stars[i * 3 + 2] = Math.sin(a) * r;
  }
  const starGeometry = new T.BufferGeometry();
  starGeometry.setAttribute("position", new T.BufferAttribute(stars, 3));
  const starfield = new T.Points(
    starGeometry,
    new T.PointsMaterial({
      size: 0.22,
      map: dotTexture,
      color: 0xb8bcff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: T.AdditiveBlending,
      toneMapped: false,
    }),
  );
  scene.add(starfield);
  const dust = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) {
    dust[i * 3] = (random() - 0.5) * 75;
    dust[i * 3 + 1] = -9 + random() * 45;
    dust[i * 3 + 2] = (random() - 0.5) * 75;
  }
  const dustGeometry = new T.BufferGeometry();
  dustGeometry.setAttribute("position", new T.BufferAttribute(dust, 3));
  const particles = new T.Points(
    dustGeometry,
    new T.PointsMaterial({
      size: 0.075,
      map: dotTexture,
      color: 0x728aff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: T.AdditiveBlending,
      toneMapped: false,
    }),
  );
  scene.add(particles);
  const ray = new T.Raycaster(),
    pointer = new T.Vector2();
  let down;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
    tour = false;
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5)
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const orderMeshes = effects.flatMap((e) => e.beads || []);
    const orderHit = ray.intersectObjects(orderMeshes, false)[0];
    if (orderHit) {
      onOrder(orderHit.object.userData.orderId);
      return;
    }
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) onSelect(hit.object.userData.id);
  });
  renderer.domElement.addEventListener("dblclick", (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit && towers.has(hit.object.userData.id))
      onSelect("workstation-" + hit.object.userData.id);
  });
  orbit.addEventListener("start", () => {
    flight = null;
    tour = false;
    following = null;
    followQueue = [];
  });
  function clearEffects() {
    extras.clear();
    for (const e of effects) {
      scene.remove(e.group);
      e.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    effects.length = 0;
    for (const t of towers.values()) t.history = [];
  }
  function update(frame, health = lastHealth) {
    lastHealth = health;
    lastFrame = frame;
    syncCities(frame);
    let total = 0;
    for (const s of frame.strategies) {
      const t = towers.get(s.id);
      if (!t) continue;
      total += s.pnl;
      const height = professionalMode
        ? 8.5
        : 7.5 + Math.min(Math.abs(s.pnl) / 2500, 4);
      t.skyline.scale.y = height / 9.5;
      t.beamGroup.visible = !professionalMode;
      t.crown.visible = !professionalMode;
      t.healthBadge.visible = professionalMode;
      t.healthBadge.material.color.setHex(
        health[s.id]?.state === "HEALTHY"
          ? 0x7396b0
          : health[s.id]?.state === "DEGRADED"
            ? 0xbd964f
            : ["STOPPED", "OFFLINE", "DISCONNECTED"].includes(
                  health[s.id]?.state,
                )
              ? 0xba6161
              : 0x8f96a4,
      );
      t.tag.visible = !professionalMode || s.id === selectedStrategy;
      t.crown.position.y = height;
      t.beamGroup.position.y = height + 0.7;
      t.tag.position.y = height + 3;
      const color =
        (health[s.id] && health[s.id].state !== "HEALTHY"
          ? health[s.id].color
          : null) ??
        (s.state === "DEGRADED"
          ? 0xffbb55
          : s.state === "STOPPED" || s.state === "IDLE"
            ? 0x6c7192
            : s.pnl < 0
              ? pink
              : cyan);
      t.beam.material.color.setHex(color);
      t.beamGroup.children[1].material.color.setHex(color);
      if (t.lastSeq !== frame.seq) {
        t.history.push(s.pnl);
        if (t.history.length > 50) t.history.shift();
        t.lastSeq = frame.seq;
      }
      textPanel(
        t.tag,
        s.name,
        [
          `${s.pnl < 0 ? "-" : "+"}$${Math.abs(s.pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
          `${s.symbol} · POS ${s.position} · ${health[s.id]?.state ?? s.state}`,
          `UPD ${(health[s.id]?.updated ?? frame.time).toFixed(1)}s · ORD ${s.orders}`,
        ],
        health[s.id] && health[s.id].state !== "HEALTHY"
          ? "#" + health[s.id].color.toString(16).padStart(6, "0")
          : s.pnl < 0
            ? "#ff69b7"
            : "#67ffdd",
        t.history,
      );
    }
    textPanel(
      vaultPanel,
      "MARKET NEXUS STATE",
      [
        `${total < 0 ? "-" : "+"}$${Math.abs(total).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
        `${frame.source?.toUpperCase() || "IMPORTED"} / ${frame.time.toFixed(1)}s`,
      ],
      "#ffdda0",
    );
    for (const b of beacons) {
      const f = frame.feeds.find((f) => f.id === b.id);
      if (f) {
        textPanel(
          b.tag,
          "MDP / FEED " + f.id,
          [
            health[f.id]?.state ?? f.state,
            `SEQ ${f.seq}`,
            `UPD ${(health[f.id]?.updated ?? frame.time).toFixed(1)}s / GAP ${f.gaps}`,
          ],
          health[f.id]
            ? "#" + health[f.id].color.toString(16).padStart(6, "0")
            : f.state === "HEALTHY"
              ? "#64eeff"
              : "#ffbb55",
        );
        feedBeams
          .get(b.id)
          .material.color.setHex(
            health[f.id]?.color ?? (f.state === "HEALTHY" ? cyan : 0xffb655),
          );
      }
    }
  }
  function pulse(position, color) {
    const group = new T.Group();
    group.position.copy(position);
    scene.add(group);
    const halo = ring(0.45, 0, color, group, 0.06);
    const sphere = add(
      new T.SphereGeometry(0.28, 12, 12),
      neon(color, 0.8),
      new T.Vector3(),
      group,
    );
    effects.push({ group, halo, sphere, age: 0, duration: 1.2, pulse: true });
  }
  function emit(event, forceFollow = false) {
    const origin =
      towers
        .get(event.strategyId)
        ?.group.position.clone()
        .add(new T.Vector3(0, 6, 0)) ||
      nodes[event.feed] ||
      nodes.risk;
    if (event.type === "SIGNAL_GENERATED") {
      extras.burst(
        origin,
        0x65ffff,
        "SIGNAL / " + event.strategyId.toUpperCase(),
        event,
      );
      return;
    }
    if (event.type === "PROFIT_LOCKED") {
      extras.burst(
        origin,
        0xffdf86,
        "PROFIT LOCKED " + event.amount.toFixed(2),
        event,
      );
      return;
    }
    if (event.type === "RISK_REJECTED" || event.type === "FEED_GAP")
      extras.burst(origin, 0xff5caa, event.type.replaceAll("_", " "), event);
    if (event.type === "RISK_WARNING" || event.type === "RISK_LIMIT_BREACHED") {
      extras.burst(
        nodes.risk,
        0xffaa44,
        event.type.replaceAll("_", " "),
        event,
      );
      return;
    }
    if (effects.length >= 100) return;
    if (event.type === "FEED_GAP" || event.type === "FEED_RECOVERED") {
      const p = nodes[event.feed];
      if (p) pulse(p, event.type === "FEED_GAP" ? 0xffaa44 : cyan);
      return;
    }
    const tower = towers.get(event.strategyId);
    if (!tower) return;
    const venue = EXCHANGES.find((e) => e.id === tower.exchange);
    const exchangeNode = new T.Vector3(venue.x, 3, venue.z);
    const gatewayNode = exchangeNode.clone().add(new T.Vector3(0, 1, 4));
    let a, b;
    switch (event.type) {
      case "ORDER_CREATED":
        a = tower.group.position.clone().add(new T.Vector3(0, 6, 0));
        b = nodes.oms;
        break;
      case "RISK_PASSED":
      case "RISK_REJECTED":
        a = nodes.oms;
        b = nodes.risk;
        break;
      case "ORDER_SENT":
        a = nodes.risk;
        b = gatewayNode;
        break;
      case "ORDER_ACK":
        a = gatewayNode;
        b = exchangeNode;
        break;
      case "FILL":
        a = exchangeNode;
        b = tower.group.position.clone().add(new T.Vector3(0, 5, 0));
        break;
      default:
        return;
    }
    const color =
      event.type === "RISK_REJECTED"
        ? pink
        : event.type === "FILL"
          ? 0x73ffcc
          : cyan;
    const curve = new T.QuadraticBezierCurve3(
      a,
      a
        .clone()
        .lerp(b, 0.5)
        .add(new T.Vector3(0, event.type === "FILL" ? 9 : 6, 0)),
      b,
    );
    const group = new T.Group();
    scene.add(group);
    const beads = [];
    for (let i = 0; i < (professionalMode ? 2 : 16); i++)
      beads.push(
        add(
          new T.SphereGeometry(i === 0 ? 0.14 : 0.065, 6, 6),
          neon(color, (1 - i / 16) * 0.9),
          null,
          group,
        ),
      );
    for (const bead of beads) bead.userData.orderId = event.orderId;
    effects.push({
      event,
      orderId: event.orderId,
      forced: forceFollow,
      group,
      curve,
      beads,
      age: 0,
      duration: 1.8,
      fill: event.type === "FILL",
      color,
      end: b,
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
    const dt = Math.min(clock.getDelta(), 0.05),
      elapsed = clock.elapsedTime;

    particles.visible = starfield.visible = !professionalMode;
    particles.rotation.y = elapsed * 0.007;
    starfield.rotation.y = elapsed * 0.0007;
    if (!professionalMode)
      for (const r of rings) r.object.rotation[r.axis] += dt * r.speed;
    extras.animate(dt, elapsed);
    for (const f of flows) {
      f.bead.visible = !professionalMode;
      const t = (elapsed * f.speed + f.phase) % 1;
      f.bead.position.copy(f.curve.getPoint(t));
      f.bead.lookAt(f.bead.position.clone().add(f.curve.getTangent(t)));
    }
    if (flight) {
      flight.age += dt;
      const p = Math.min(flight.age / 1.5, 1),
        smooth = p * p * (3 - 2 * p);
      camera.position.lerpVectors(flight.from, flight.to, smooth);
      orbit.target.lerpVectors(flight.targetFrom, flight.targetTo, smooth);
      if (p >= 1) flight = null;
    }
    if (tour && !flight) {
      const a = elapsed * 0.035;
      camera.position.set(
        Math.sin(a) * 125,
        85 + Math.sin(elapsed * 0.13) * 5,
        Math.cos(a) * 125,
      );
      orbit.target.set(0, 5, 0);
    }
    if (following) {
      followTimer -= dt;
      if (followQueue.length && followTimer <= 0) {
        emit(followQueue.shift(), true);
        followTimer = 1.95;
      }
      const candidates = effects.filter(
        (e) => e.orderId === following && !e.pulse,
      );
      const active = candidates.find((e) => e.forced) || candidates.at(-1);
      if (active) {
        const p = active.curve.getPoint(
          Math.min(active.age / active.duration, 1),
        );
        camera.position.lerp(p.clone().add(new T.Vector3(6, 5, 8)), 0.055);
        orbit.target.lerp(p, 0.09);
      }
    }
    orbit.update();
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      const p = e.age / e.duration;
      if (e.pulse) {
        e.halo.scale.setScalar(1 + p * 7);
        e.halo.material.transparent = true;
        e.halo.material.opacity = 1 - p;
        e.sphere.scale.setScalar(1 + p * 2);
        e.sphere.material.opacity = (1 - p) * 0.8;
      } else
        e.beads.forEach((m, j) => {
          const t = Math.max(0, Math.min(1, p - j * 0.013));
          m.position.copy(e.curve.getPoint(t));
          m.visible = p - j * 0.013 >= 0;
        });
      if (p >= 1) {
        if (e.fill && effects.length < 100)
          extras.burst(e.end, e.color, "FILL CONFIRMED", e.event);
        scene.remove(e.group);
        e.group.traverse((o) => {
          o.geometry?.dispose();
          o.material?.dispose();
        });
        effects.splice(i, 1);
      }
    }
    if (professionalMode) renderer.render(scene, camera);
    else composer.render();
  }
  function fly(position, target) {
    tour = false;
    following = null;
    followQueue = [];
    flight = {
      from: camera.position.clone(),
      to: position,
      targetFrom: orbit.target.clone(),
      targetTo: target,
      age: 0,
    };
  }
  const ground = add(
    new T.PlaneGeometry(200, 185),
    new T.MeshStandardMaterial({ color: 0x202a34, roughness: 1, metalness: 0 }),
    new T.Vector3(0, -0.92, 0),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.userData.semantic = true;
  const grid = new T.GridHelper(200, 40, 0x46545f, 0x2d3b47);
  grid.position.y = -0.9;
  grid.userData.semantic = true;
  scene.add(grid);
  function applySceneMaterials() {
    facade.uniforms.uProfessional.value = professionalMode ? 1 : 0;
    scene.background.set(professionalMode ? "#171f28" : "#040315");
    scene.fog.color.set(professionalMode ? "#171f28" : "#080726");
    scene.fog.density = professionalMode ? 0.001 : 0.0025;
    bloom.enabled = !professionalMode;
    ground.visible = grid.visible = professionalMode;
    scene.traverse((o) => {
      if (o.userData.ornament) o.visible = !professionalMode;
      if (o.userData.semantic) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (m && m !== facade && !m.isSpriteMaterial && m.color) {
          if (!originalMaterials.has(m))
            originalMaterials.set(m, {
              color: m.color.clone(),
              emissive: m.emissive?.clone(),
              intensity: m.emissiveIntensity,
              roughness: m.roughness,
              metalness: m.metalness,
              opacity: m.opacity,
            });
          const original = originalMaterials.get(m);
          if (professionalMode) {
            m.color.set(
              m.isMeshStandardMaterial
                ? 0x52616f
                : m.isLineBasicMaterial
                  ? 0x738899
                  : 0x8d9eac,
            );
            if (m.emissive) m.emissive.set(0x000000);
            if (m.isMeshStandardMaterial) {
              m.roughness = 0.85;
              m.metalness = 0.1;
            }
            if (m.transparent) m.opacity = Math.min(original.opacity, 0.45);
          } else {
            m.color.copy(original.color);
            if (m.emissive && original.emissive)
              m.emissive.copy(original.emissive);
            if (m.isMeshStandardMaterial) {
              m.roughness = original.roughness;
              m.metalness = original.metalness;
            }
            m.opacity = original.opacity;
          }
        }
    });
  }
  applySceneMaterials();
  animate();
  return {
    update,
    emit,
    clearEffects,
    data(frame, events, history) {
      extras.update(frame, events, history);
      applySceneMaterials();
    },
    histories(cards) {
      extras.histories(cards);
    },
    interior(id) {
      const view = extras.interior(id);
      fly(view.position, view.target);
    },
    health(map) {
      if (lastFrame) update(lastFrame, map);
    },
    followOrder(id, events) {
      following = id;
      followQueue = events.filter((e) => e.orderId === id);
      followTimer = 0;
      tour = false;
      flight = null;
    },
    stopFollow() {
      following = null;
      followQueue = [];
    },
    focus(id) {
      if (towers.has(id)) {
        selectedStrategy = id;
        extras.selectStrategy(id);
        if (professionalMode && !autoFocus) {
          for (const [key, t] of towers) t.selection.visible = key === id;
          return;
        }
      }
      if (id.startsWith("city-")) {
        const v = EXCHANGES.find((e) => e.id === id.slice(5));
        if (v) {
          const p = new T.Vector3(v.x, 3, v.z);
          fly(p.clone().add(new T.Vector3(18, 24, 28)), p);
        }
        return;
      }
      if (id.startsWith("pnl-bridge-")) id = id.slice(11);
      for (const [key, t] of towers) t.selection.visible = key === id;
      const t = towers.get(id);
      if (t) {
        const p = t.group.position.clone();
        fly(
          p.clone().add(new T.Vector3(9, 11, 14)),
          p.clone().add(new T.Vector3(0, 5, 0)),
        );
      } else if (nodes[id])
        fly(nodes[id].clone().add(new T.Vector3(10, 8, 13)), nodes[id]);
    },
    home() {
      fly(homePosition.clone(), homeTarget.clone());
    },
    professional(value) {
      professionalMode = value;
      extras.professional(value);
      applySceneMaterials();
      if (lastFrame) update(lastFrame);
    },
    cameraFocus(value) {
      autoFocus = value;
    },
    bridgeScale(value) {
      extras.bridgeScale(value);
    },
    cinematic(value) {
      bloom.strength = value ? 1.35 : 1.05;
    },
    tour(value) {
      tour = value;
      flight = null;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      orbit.dispose();
      clearEffects();
      const geometries = new Set(),
        materials = new Set(),
        textures = new Set();
      scene.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (m) {
            materials.add(m);
            if (m.map) textures.add(m.map);
          }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
