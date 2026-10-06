import "./style.css";
import { sanitizeWorkspace, operationRows, pnlBounds } from "./workstation.js";
const HOSTED_PREVIEW = import.meta.env.VITE_HOSTED_PREVIEW === "1";
let workspace;
try {
  workspace = sanitizeWorkspace(
    JSON.parse(localStorage.getItem("nexus-workspace") || "{}"),
  );
} catch {
  workspace = sanitizeWorkspace();
}
function saveWorkspace() {
  try {
    localStorage.setItem("nexus-workspace", JSON.stringify(workspace));
  } catch {}
}

import { EXCHANGES, exchangeOf, exchangeTotals } from "./exchanges.js";
import { createWindows } from "./windows.js";
import { eventText, priceSeries, snapshotCards } from "./presentation.js";
import {
  entityHealth,
  bookmarks,
  indexedEvents,
  lifecycleRows,
} from "./insights.js";
import { createCity } from "./city.js";
import {
  generateSession,
  validateSession,
  validateFrame,
  frameAt,
} from "./model.js";
const $ = (id) => document.getElementById(id);
const money = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let local = generateSession(),
  frames = local.frames,
  displayed = frames[0],
  log = [],
  selected = "mm";
let time = 0,
  end = 600,
  playing = true,
  speed = 1,
  mode = "local",
  remote = null;
let ws = null,
  reconnect = null,
  connectionGeneration = 0,
  loadGeneration = 0,
  lastReceived = 0,
  loading = false;
const windows = createWindows($("detail-windows"));
let historyCards = [],
  selectedPopup = null;
let city,
  connected = false,
  activeOrder = null,
  orderEvents = [],
  bookmarkItems = [],
  bookmarkGeneration = 0,
  followGeneration = 0;
try {
  city = createCity($("world"), select, followOrder);
  city.cinematic(false);
} catch (e) {
  $("notice").textContent = `WebGL unavailable: ${e.message}`;
  city = {
    update() {},
    emit() {},
    clearEffects() {},
    focus() {},
    home() {},
    cinematic() {},
    professional() {},
    cameraFocus() {},
    bridgeScale() {},
    tour() {},
    health() {},
    data() {},
    histories() {},
    interior() {},
    followOrder() {},
    stopFollow() {},
  };
}
const kv = (k, v) =>
  `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
function healthMap(now = performance.now()) {
  return Object.fromEntries(
    [...displayed.strategies, ...displayed.feeds].map((e) => [
      e.id,
      entityHealth(e, {
        live: mode === "live",
        connected,
        lastReceived,
        now,
        frameTime: displayed.time,
      }),
    ]),
  );
}
function refreshHealth() {
  const map = healthMap();
  city.health(map);
  const states = [...new Set(Object.values(map).map((h) => h.state))];
  $("health-status").textContent =
    `${mode === "live" ? "LIVE HEALTH" : "RECORDED HEALTH"} · ${states.join(" / ")} · snapshot ${displayed.time.toFixed(3)}s${mode === "live" && lastReceived ? " · received " + Math.max(0, (performance.now() - lastReceived) / 1000).toFixed(1) + "s ago" : ""}`;
  return map;
}
function select(id) {
  if (id.startsWith("city-")) {
    city.focus(id);
    const venue = exchangeTotals(displayed.strategies).find(
      (e) => e.id === id.slice(5),
    );
    if (venue) windows.open(id, venue.id + " CITY", cityHtml(venue));
    return;
  }
  if (id.startsWith("pnl-bridge-")) {
    const key = id.slice(11);
    city.focus(key);
    openPnlWindow(key);
    return;
  }

  if (id === "pnl-bridge") {
    openPnlWindow();
    return;
  }
  if (id.startsWith("event-")) {
    const event = log.find((e) => e.id === id.slice(6));
    if (event) {
      if (event.orderId) followOrder(event.orderId);
      else
        windows.open(
          id,
          event.type.replaceAll("_", " "),
          kv("Time", event.time.toFixed(6) + "s") +
            `<p>${esc(eventText(event))}</p>`,
        );
    }
    return;
  }
  if (id.startsWith("vehicle-")) {
    windows.open(
      id,
      "HOVERCAR / " + id,
      `<p>Decorative orbital traffic. This vehicle represents no trade or position.</p>${kv("Lane", Number(id.split("-")[1]) + 1)}${kv("Motion", "Autonomous cinematic path")}`,
    );
    return;
  }
  if (id.startsWith("history-")) {
    const card = historyCards[Number(id.split("-")[1])];
    if (card) openHistory(card);
    return;
  }
  if (id === "workstation" || id.startsWith("workstation-")) {
    const key = id === "workstation" ? selected : id.slice(12);
    selectedPopup = displayed.strategies.some((s) => s.id === key)
      ? key
      : displayed.strategies[0].id;
    city.interior(selectedPopup);
    openStrategyWindow(selectedPopup, "workstation");
    return;
  }
  if (id.startsWith("chart-") || id.startsWith("scanner-")) {
    const key = id.slice(id.indexOf("-") + 1);
    openStrategyWindow(key, id.startsWith("chart-") ? "chart" : "scanner");
    return;
  }
  selected = id;
  if (displayed.strategies.some((s) => s.id === id))
    $("display-strategy").value = id;
  city.focus(id);
  inspect();
  if (workspace.theme === "showcase") openEntityWindow(id);
}
function inspect() {
  const s = displayed.strategies.find((x) => x.id === selected),
    f = displayed.feeds.find((x) => x.id === selected);
  let html = s
    ? `<h3>${esc(s.name)}</h3>` +
      [
        ["Instrument", s.symbol],
        ["Status", s.state],
        ["P&L", money(s.pnl)],
        ["Position", s.position],
        ["Orders", s.orders],
        ["Fills", s.fills],
        ["p99 (µs)", s.latency / 1000],
      ]
        .map((x) => kv(...x))
        .join("")
    : f
      ? `<h3>Feed ${f.id}</h3>` +
        [
          ["Health", f.state],
          ["Packet sequence", f.seq],
          ["Observed gaps", f.gaps],
        ]
          .map((x) => kv(...x))
          .join("")
      : `<h3>${esc(selected.toUpperCase())}</h3><p class="muted">Read-only infrastructure observer. Animation durations do not represent measured execution latency.</p>`;
  const h = healthMap()[selected];
  if (h)
    html +=
      kv("Health", h.state) +
      kv("Last snapshot (session s)", h.updated.toFixed(3)) +
      kv("Age (s)", h.age === null ? "Unavailable" : h.age.toFixed(1));
  html += kv("Producer drops", displayed.dropped ?? "Not supplied");
  const order = log.find((e) => e.orderId && (!s || e.strategyId === s.id));
  if (order)
    html +=
      '<h2 style="margin-top:20px">Latest observed order</h2>' +
      [
        ["Order", order.orderId],
        ["Stage", order.type],
        ["Side", order.side],
        ["Quantity", order.qty],
        ["Price", order.price],
      ]
        .map((x) => kv(...x))
        .join("");
  if (order) {
    const stages = log
      .filter((e) => e.orderId === order.orderId)
      .sort((a, b) => a.time - b.time);
    html +=
      '<h2 style="margin-top:16px">Observed lifecycle</h2>' +
      stages.map((e) => kv(e.type, e.time.toFixed(6) + "s")).join("");
  }
  if (order)
    html += `<button class="follow-order" data-order="${esc(order.orderId)}">Follow this order</button>`;
  if (workspace.theme === "professional" && s) {
    html +=
      '<h2 style="margin-top:16px">Price / signal</h2>' +
      kv("Chart data", priceSeries(s, log).label) +
      '<canvas class="window-chart" width="480" height="170" data-chart="' +
      s.id +
      '"></canvas>' +
      kv("Signal", s.signal?.label ?? "Not supplied") +
      kv(
        "Charge",
        s.signal ? s.signal.charge.toFixed(0) + "%" : "Not supplied",
      ) +
      '<button data-inspector-pnl="' +
      s.id +
      '">P&L bridge</button><button data-inspector-detail="' +
      s.id +
      '">Full details / pop out</button>';
  }
  $("inspector").innerHTML = html;
  paintWindowCharts($("inspector"));
}
function draw(frame, events = []) {
  displayed = frame;
  $("scene-source").textContent =
    `${(frame.source || "imported").toUpperCase()} / ${mode.toUpperCase()}`;
  city.update(frame, healthMap());
  renderOperations();
  renderProvenance();
  city.data(
    frame,
    [...log].reverse(),
    frames.filter((f) => f.time <= frame.time).slice(-240),
  );
  syncVenueControls();
  renderMonitors();
  refreshContextWindows();
  renderTicker(frame);
  refreshHealth();
  events.forEach((e) => city.emit(e));
  $("metrics").innerHTML = [
    ["Session P&L", money(frame.strategies.reduce((a, s) => a + s.pnl, 0))],
    ["Filled orders", frame.strategies.reduce((a, s) => a + s.fills, 0)],
    [
      "Feed health",
      frame.feeds.every((x) => x.state === "HEALTHY") ? "HEALTHY" : "DEGRADED",
    ],
    ["Source", (frame.source || "imported").toUpperCase()],
  ]
    .map(
      ([k, v]) =>
        `<div class="metric"><small>${k}</small><strong>${v}</strong></div>`,
    )
    .join("");
  renderStrategyTree();
  $("feeds").innerHTML = frame.feeds
    .map(
      (f) =>
        `<button class="row" data-id="${f.id}"><span>Feed ${f.id}<small>seq ${f.seq.toLocaleString()}</small></span><b class="${f.state === "HEALTHY" ? "positive" : "negative"}">${f.state}</b></button>`,
    )
    .join("");
  $("events").innerHTML = log
    .slice(0, 12)
    .map(
      (e) =>
        `<div class="event" ${e.orderId ? `data-order="${esc(e.orderId)}" tabindex="0" role="button"` : ""}><b>${esc(e.type)}</b><br>${esc(e.orderId || e.strategyId || `Feed ${e.feed}`)} · ${e.time.toFixed(3)}s</div>`,
    )
    .join("");
  $("latencies").innerHTML = frame.strategies
    .map(
      (s) =>
        `<div class="latency"><span>${esc(s.symbol)} ${s.latency} ns</span><i style="width:${Math.min(s.latency / 10000, 1) * 100}%"></i></div>`,
    )
    .join("");
  const c = $("pnl-chart"),
    ctx = c.getContext("2d");
  const history = frames.filter((f) => f.time <= frame.time).slice(-180);
  ctx.clearRect(0, 0, c.width, c.height);
  if (history.length) {
    const values = history.map((f) =>
      f.strategies.reduce((sum, s) => sum + s.pnl, 0),
    );
    const min = Math.min(...values),
      max = Math.max(...values),
      range = max - min || 1;
    ctx.strokeStyle = "#62efcf";
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = 10 + (i / (values.length - 1 || 1)) * (c.width - 20),
        y = 30 + (1 - (v - min) / range) * (c.height - 55);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "#7893ab";
    ctx.font = "18px monospace";
    ctx.fillText(money(max), 10, 20);
  }
  $("clock").textContent = `${frame.time.toFixed(1)}s`;
  $("scrub").value = time;
  inspect();
}
function controls() {
  $("play").textContent = playing ? "Pause" : "Play";
  for (const id of ["play", "speed", "scrub"]) $(id).disabled = mode === "live";
  $("scrub").max = end;
  $("scrub").min =
    mode === "local" ? frames[0].time : (remote?.start_time ?? 0);
  $("mode").textContent = mode.toUpperCase();
  $("connect").textContent = mode === "live" ? "Disconnect" : "Watch live";
}
function stopLive() {
  connected = false;
  connectionGeneration++;
  clearTimeout(reconnect);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}
async function api(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw Error((await r.json()).error || `HTTP ${r.status}`);
  return r.json();
}
async function refresh() {
  if (HOSTED_PREVIEW) return;
  try {
    const data = await api("/api/sessions");
    const old = $("sessions").value;
    $("sessions").innerHTML =
      '<option value="">Stored sessions</option>' +
      data.sessions
        .map(
          (s) =>
            `<option value="${esc(s.id)}">${esc(s.label)} [${s.source}] · ${s.frame_count} frames</option>`,
        )
        .join("");
    $("sessions").value = old;
    $("sessions").sessionData = data.sessions;
    if (remote) {
      const summaries = await Promise.all(
        data.sessions
          .slice(0, 12)
          .map((s) => api(`/api/sessions/${encodeURIComponent(s.id)}/summary`)),
      );
      setHistory(
        summaries.map((s) => ({
          id: s.id,
          label: s.created.slice(0, 10),
          title: s.label,
          pnl: s.pnl,
          source: s.source,
          remote: true,
        })),
      );
    }
  } catch (e) {
    $("notice").textContent =
      "Telemetry server unavailable. Local demo and file replay remain available.";
  }
}
async function seek(t) {
  if (mode === "live") return;
  const generation = ++loadGeneration;
  loading = true;
  city.clearEffects();
  city.stopFollow();
  try {
    if (
      mode === "recording" &&
      (!frames.length || t < frames[0].time || t > frames.at(-1).time)
    ) {
      const data = await api(
        `/api/sessions/${encodeURIComponent(remote.id)}/frames?at=${t}&limit=500`,
      );
      if (generation !== loadGeneration) return;
      frames = data.frames.map(validateFrame);
      if (!frames.length) throw Error("No recorded frames");
    }
    if (generation !== loadGeneration) return;
    time = t;
    const f = frameAt(frames, t);
    log = frames
      .filter((x) => x.time <= t)
      .flatMap((x) => x.events)
      .slice(-60)
      .reverse();
    draw(f);
    controls();
  } catch (e) {
    if (generation === loadGeneration) {
      playing = false;
      $("notice").textContent = e.message;
      controls();
    }
  } finally {
    if (generation === loadGeneration) loading = false;
  }
}
function loadLocal(s) {
  stopOrder();
  bookmarkGeneration++;
  validateSession(s);
  stopLive();
  loadGeneration++;
  loading = false;
  remote = null;
  mode = "local";
  local = s;
  frames = s.frames;
  end = frames.at(-1).time;
  playing = true;
  $("connection").textContent =
    frames[0].source === "demo" ? "LOCAL DEMO" : "IMPORTED REPLAY";
  seek(frames[0].time);
  setHistory(snapshotCards(local.frames));
  loadBookmarks();
}
async function openRecording() {
  const item = $("sessions").sessionData?.find(
    (s) => s.id === $("sessions").value,
  );
  if (!item) {
    $("notice").textContent = "Select a stored session first.";
    return;
  }
  stopLive();
  loadGeneration++;
  remote = item;
  mode = "recording";
  frames = [];
  end = item.end_time;
  playing = false;
  $("connection").textContent = "STORED RECORDING";
  stopOrder();
  await seek(item.start_time);
  refresh();
  loadBookmarks();
}
function watch() {
  if (mode === "live") {
    stopLive();
    mode = "recording";
    frames = [];
    playing = false;
    seek(time);
    loadBookmarks();
    return;
  }
  const item = $("sessions").sessionData?.find(
    (s) => s.id === $("sessions").value,
  );
  if (!item) {
    $("notice").textContent =
      "Select a stored session first. Publish telemetry or run npm run demo to create one.";
    return;
  }
  stopLive();
  loadGeneration++;
  loading = false;
  remote = item;
  stopOrder();
  mode = "live";
  lastReceived = 0;
  connected = false;
  frames = [];
  log = [];
  playing = false;
  controls();
  const generation = connectionGeneration;
  function connect() {
    if (generation !== connectionGeneration) return;
    $("connection").textContent = "CONNECTING";
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?session=${encodeURIComponent(item.id)}`,
    );
    ws = socket;
    socket.onopen = () => {
      if (generation !== connectionGeneration) return;
      connected = true;
      refreshHealth();
    };
    let seq = -1,
      previousTime = -1;
    let first = true;
    socket.onmessage = (e) => {
      if (generation !== connectionGeneration || socket !== ws) return;
      try {
        if (typeof e.data !== "string" || e.data.length > 131072)
          throw Error("Invalid telemetry size");
        const f = validateFrame(JSON.parse(e.data));
        if (f.seq <= seq || f.time <= previousTime)
          throw Error("Out-of-order frame");
        if (seq >= 0 && f.seq !== seq + 1)
          $("notice").textContent =
            "Telemetry sequence gap; full state repaired. Some event animations are unavailable.";
        seq = f.seq;
        previousTime = f.time;
        lastReceived = performance.now();
        time = f.time;
        end = f.time;
        frames.push(f);
        if (frames.length > 12000) frames.shift();
        log = [...f.events].reverse().concat(log).slice(0, 60);
        draw(f, first ? [] : f.events);
        first = false;
        if (activeOrder) {
          const additions = f.events.filter((e) => e.orderId === activeOrder);
          if (additions.length) {
            orderEvents.push(...additions);
            renderOrder();
          }
        }
        $("connection").textContent =
          `CONNECTED / ${f.source?.toUpperCase() || "TELEMETRY"}`;
      } catch (err) {
        $("notice").textContent = `Rejected telemetry: ${err.message}`;
      }
    };
    socket.onclose = () => {
      if (generation !== connectionGeneration) return;
      connected = false;
      refreshHealth();
      $("connection").textContent = "DISCONNECTED / RETRYING";
      reconnect = setTimeout(connect, 2000);
    };
    socket.onerror = () => {
      $("notice").textContent =
        "Live connection unavailable; reconnecting automatically.";
    };
  }
  connect();
  loadBookmarks();
}
function openEntityWindow(id) {
  const s = displayed.strategies.find((s) => s.id === id),
    f = displayed.feeds.find((f) => f.id === id);
  if (s) openStrategyWindow(id, "strategy");
  else if (f) {
    windows.open(
      "feed-" + id,
      "FEED " + id,
      kv("Health", healthMap()[id].state) +
        kv("Sequence", f.seq) +
        kv("Gaps", f.gaps),
    );
  } else
    windows.open(
      id,
      id.toUpperCase(),
      "<p>Read-only infrastructure component.</p>" +
        kv("Capture source", displayed.source || "imported") +
        kv("Snapshot", displayed.time.toFixed(3) + "s"),
    );
}
function strategyHtml(id, kind) {
  const s = displayed.strategies.find((s) => s.id === id);
  if (!s) return "<p>Strategy unavailable.</p>";
  const signal = s.signal,
    series = priceSeries(s, log),
    latestOrder = log.find((e) => e.strategyId === id && e.orderId);
  return (
    `<h3>${esc(s.name)} / ${esc(s.symbol)}</h3>` +
    kv("Source", displayed.source || "imported") +
    kv("Exchange city", exchangeOf(s)) +
    kv("Health", healthMap()[id].state) +
    kv("P&L", money(s.pnl)) +
    kv("Position", s.position) +
    kv("Orders", s.orders) +
    kv("Fills", s.fills) +
    kv("Latency (ns)", s.latency) +
    kv("Snapshot (s)", displayed.time.toFixed(3)) +
    kv("Producer state", s.state) +
    kv("Latest price", s.market?.price ?? "Not supplied") +
    (kind === "scanner" || kind === "workstation" || kind === "strategy"
      ? signal
        ? kv("Setup", signal.label) +
          kv("Direction", signal.direction) +
          kv("Charge", signal.charge.toFixed(0) + "%") +
          kv("Status", signal.status)
        : "<p>Signal telemetry not supplied.</p>"
      : "") +
    (kind === "chart" || kind === "workstation" || kind === "strategy"
      ? kv("Chart data", series.label) +
        kv("Latest price", series.price ?? "Not supplied") +
        '<canvas class="window-chart" width="480" height="170" data-chart="' +
        id +
        '"></canvas>'
      : "") +
    `<button data-pnl-strategy="${id}">Strategy P&L bridge</button><button data-interior="${id}">Enter workstation</button>` +
    `<button data-scanner="${id}">Signal scanner</button>` +
    (latestOrder
      ? '<button data-follow="' +
        esc(latestOrder.orderId) +
        '">Follow this order</button>'
      : "") +
    "<h4>Observed activity</h4>" +
    log
      .filter((e) => e.strategyId === id)
      .slice(0, 8)
      .map(
        (e) =>
          `<p class="muted">${e.time.toFixed(3)}s · ${esc(eventText(e))}</p>`,
      )
      .join("")
  );
}
function openStrategyWindow(id, kind) {
  const body = windows.open(
    kind + "-" + id,
    kind.toUpperCase() + " / " + id.toUpperCase(),
    strategyHtml(id, kind),
  );
  paintWindowCharts(body);
}
function paintWindowCharts(host) {
  for (const canvas of host.querySelectorAll("[data-chart]")) {
    const s = displayed.strategies.find((s) => s.id === canvas.dataset.chart);
    if (!s) continue;
    const bars = priceSeries(s, log).bars;
    const x = canvas.getContext("2d");
    x.clearRect(0, 0, 480, 170);
    if (!bars.length) continue;
    const low = Math.min(...bars.map((b) => b.low)),
      high = Math.max(...bars.map((b) => b.high)),
      span = high - low || 1;
    bars.forEach((b, i) => {
      const px = 12 + (i / (bars.length - 1 || 1)) * 455,
        y = (v) => 15 + (1 - (v - low) / span) * 135;
      x.strokeStyle = b.close >= b.open ? "#65f4d8" : "#ff6bad";
      x.fillStyle = x.strokeStyle;
      x.beginPath();
      x.moveTo(px, y(b.high));
      x.lineTo(px, y(b.low));
      x.stroke();
      x.fillRect(
        px - 2,
        Math.min(y(b.open), y(b.close)),
        4,
        Math.max(2, Math.abs(y(b.open) - y(b.close))),
      );
    });
  }
}
function refreshContextWindows() {
  for (const s of displayed.strategies)
    for (const kind of ["strategy", "chart", "scanner", "workstation"]) {
      const key = kind + "-" + s.id;
      if (windows.has(key)) windows.update(key, strategyHtml(s.id, kind));
    }
  for (const f of displayed.feeds)
    if (windows.has("feed-" + f.id))
      windows.update(
        "feed-" + f.id,
        kv("Health", healthMap()[f.id].state) +
          kv("Sequence", f.seq) +
          kv("Gaps", f.gaps),
      );
  paintWindowCharts($("detail-windows"));
  if (windows.has("pnl-bridge")) windows.update("pnl-bridge", pnlWindowHtml());
  for (const s of displayed.strategies)
    if (windows.has("pnl-bridge-" + s.id))
      windows.update("pnl-bridge-" + s.id, pnlWindowHtml(s.id));
  for (const e of exchangeTotals(displayed.strategies))
    if (windows.has("city-" + e.id))
      windows.update("city-" + e.id, cityHtml(e));
  paintPnlWindows();
  windows.syncPopouts();
}
function windowsHost() {
  return $("detail-windows");
}
function displayStrategy() {
  return $("display-strategy").value || "mm";
}
function paintPnl(canvas, strategyId = null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  const samples = frames
    .filter(
      (f) =>
        f.time <= displayed.time &&
        (!strategyId || f.strategies.some((s) => s.id === strategyId)),
    )
    .slice(-240);
  const values = samples.map((f) =>
    strategyId
      ? f.strategies.find((s) => s.id === strategyId).pnl
      : f.strategies.reduce((n, s) => n + s.pnl, 0),
  );
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#09172b";
  ctx.fillRect(0, 0, w, h);
  const { low, high } = pnlBounds(
    samples,
    strategyId,
    !!strategyId && workspace.scale === "shared",
  );
  const span = high - low || 1;
  ctx.strokeStyle = "#243e53";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(8, 25 + (i * (h - 40)) / 3);
    ctx.lineTo(w - 8, 25 + (i * (h - 40)) / 3);
    ctx.stroke();
  }
  const zeroY = 28 + (1 - (0 - low) / span) * (h - 45);
  ctx.strokeStyle = "#637a8d";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(10, zeroY);
  ctx.lineTo(w - 10, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = workspace.theme === "professional" ? "#98adbd" : "#71ffdc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = 10 + (i * (w - 20)) / (values.length - 1 || 1),
      y = 28 + (1 - (v - low) / span) * (h - 45);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = workspace.theme === "professional" ? "#b4c5d1" : "#bcf8e5";
  ctx.font = "14px monospace";
  ctx.fillText(
    (strategyId ? strategyId.toUpperCase() + " " : "TOTAL ") +
      money(values.at(-1) || 0) +
      " · " +
      samples.length +
      " source snapshots",
    10,
    17,
  );
  ctx.font = "11px monospace";
  ctx.fillText(
    "USD " +
      low.toFixed(0) +
      " … " +
      high.toFixed(0) +
      " · " +
      (strategyId ? workspace.scale : "aggregate"),
    10,
    h - 3,
  );
  canvas.onpointermove = (e) => {
    if (!samples.length) return;
    const r = canvas.getBoundingClientRect(),
      i = Math.max(
        0,
        Math.min(
          samples.length - 1,
          Math.round(((e.clientX - r.left) / r.width) * (samples.length - 1)),
        ),
      );
    canvas.title =
      "Session " +
      samples[i].time.toFixed(3) +
      "s · USD " +
      values[i].toFixed(2);
  };
}
function pnlWindowHtml(strategyId = null) {
  const strategy = displayed.strategies.find((s) => s.id === strategyId);
  return (
    kv("Source", displayed.source || "imported") +
    kv(
      "Scope",
      strategy
        ? exchangeOf(strategy) + " / " + strategy.name
        : "Market Nexus state total",
    ) +
    kv(
      "Recorded P&L",
      money(
        strategy
          ? strategy.pnl
          : displayed.strategies.reduce((n, s) => n + s.pnl, 0),
      ),
    ) +
    kv("Snapshot", displayed.time.toFixed(3) + "s") +
    '<canvas width="480" height="200" class="window-chart" data-pnl="' +
    (strategyId || "total") +
    '"></canvas><p class="muted">This physical bridge plots only this scope’s observed P&L snapshots, up to 240 loaded frames.</p>' +
    (strategy
      ? kv("Position", strategy.position) +
        kv("Orders", strategy.orders) +
        kv("Fills", strategy.fills)
      : displayed.strategies
          .map((s) => kv(exchangeOf(s) + " / " + s.name, money(s.pnl)))
          .join(""))
  );
}
function paintPnlWindows() {
  for (const c of windowsHost().querySelectorAll("[data-pnl]"))
    paintPnl(c, c.dataset.pnl === "total" ? null : c.dataset.pnl);
}
function openPnlWindow(strategyId = null) {
  const id = strategyId ? "pnl-bridge-" + strategyId : "pnl-bridge";
  windows.open(
    id,
    strategyId ? "STRATEGY P&L BRIDGE / " + strategyId : "STATE P&L BRIDGE",
    pnlWindowHtml(strategyId),
  );
  paintPnlWindows();
}
function cityHtml(venue) {
  return (
    kv("Exchange", venue.id) +
    kv("Strategy towers", venue.strategies.length) +
    kv("Observed city P&L", money(venue.pnl)) +
    venue.strategies
      .map(
        (s) =>
          "<h3>" +
          esc(s.name) +
          " / " +
          esc(s.symbol) +
          "</h3>" +
          kv("P&L", money(s.pnl)) +
          '<button data-pnl-strategy="' +
          s.id +
          '">Inspect P&L bridge</button><button data-details="' +
          s.id +
          '">Tower details</button>',
      )
      .join("")
  );
}
let venueSignature = "",
  previousStrategyIds = new Set();
function syncVenueControls() {
  const signature = displayed.strategies
    .map((s) => s.id + ":" + exchangeOf(s) + ":" + s.name)
    .join("|");
  if (signature === venueSignature) return;
  venueSignature = signature;
  const active = new Set(displayed.strategies.map((s) => s.id));
  for (const id of previousStrategyIds)
    if (!active.has(id))
      for (const kind of [
        "strategy",
        "chart",
        "scanner",
        "workstation",
        "pnl-bridge",
      ])
        windows.close(kind + "-" + id);
  previousStrategyIds = active;
  if (!active.has(selected) && !displayed.feeds.some((f) => f.id === selected))
    selected = displayed.strategies[0].id;
  const old = displayStrategy();
  $("display-strategy").innerHTML = exchangeTotals(displayed.strategies)
    .filter((e) => e.strategies.length)
    .map(
      (e) =>
        '<optgroup label="' +
        e.id +
        ' CITY">' +
        e.strategies
          .map(
            (s) => '<option value="' + s.id + '">' + esc(s.name) + "</option>",
          )
          .join("") +
        "</optgroup>",
    )
    .join("");
  if (displayed.strategies.some((s) => s.id === old))
    $("display-strategy").value = old;
}
function renderMonitors() {
  const id = displayStrategy(),
    s =
      displayed.strategies.find((s) => s.id === id) || displayed.strategies[0];
  $("monitor-title").textContent = exchangeOf(s) + " / " + s.symbol + " PRICE";
  $("visible-price-chart").dataset.chart = s.id;
  $("monitor-price-label").textContent =
    priceSeries(s, log).label +
    " · " +
    (s.market?.price ?? "price unavailable");
  paintWindowCharts($("monitor-dock"));
  paintPnl($("visible-pnl-chart"), s.id);
  const signal = s.signal;
  $("visible-signal").innerHTML = signal
    ? "<strong>" +
      esc(signal.label) +
      '</strong><div class="signal-meter"><i style="width:' +
      signal.charge +
      '%"></i></div><b>' +
      signal.charge.toFixed(0) +
      "% CHARGED · " +
      esc(signal.direction) +
      " · " +
      esc(signal.status) +
      "</b>"
    : "<p>Signal telemetry not supplied.</p>";
  $("visible-signal").innerHTML += log
    .filter((e) => e.strategyId === s.id)
    .slice(0, 3)
    .map((e) => "<p>" + e.time.toFixed(2) + "s · " + esc(eventText(e)) + "</p>")
    .join("");
}
$("display-strategy").innerHTML = displayed.strategies
  .map((s) => '<option value="' + s.id + '">' + esc(s.name) + "</option>")
  .join("");
$("display-strategy").onchange = () => {
  select(displayStrategy());
  renderMonitors();
};
$("show-details").onclick = () =>
  openStrategyWindow(displayStrategy(), "strategy");
$("show-prices").onclick = $("monitor-price-open").onclick = () =>
  openStrategyWindow(displayStrategy(), "chart");
$("show-signals").onclick = $("monitor-signal-open").onclick = () =>
  openStrategyWindow(displayStrategy(), "scanner");
$("show-pnl").onclick = $("monitor-pnl-open").onclick = () =>
  openPnlWindow(displayStrategy());
$("show-workstation").onclick = () =>
  select("workstation-" + displayStrategy());
$("toggle-monitors").onclick = () => {
  const hidden = !$("monitor-dock").hidden;
  $("monitor-dock").hidden = hidden;
  workspace.monitors = !hidden;
  saveWorkspace();
  $("toggle-monitors").textContent = hidden ? "Show monitors" : "Hide monitors";
  $("toggle-monitors").setAttribute("aria-pressed", String(!hidden));
};

function renderProvenance() {
  const age =
    mode === "live"
      ? lastReceived
        ? Math.max(0, (performance.now() - lastReceived) / 1000).toFixed(1) +
          "s since receipt"
        : "waiting for stream"
      : "Recorded session time";
  $("provenance").textContent =
    (HOSTED_PREVIEW
      ? "PRIVATE PREVIEW / browser demo & imports"
      : "LOCAL OBSERVER") +
    " · " +
    (displayed.source || "imported").toUpperCase() +
    " · " +
    mode.toUpperCase() +
    " · FRAME " +
    displayed.seq +
    " · " +
    displayed.time.toFixed(3) +
    "s · " +
    age +
    " · DROPS " +
    (displayed.dropped ?? "not supplied");
}
function renderStrategyTree() {
  const query = $("strategy-search").value.toLowerCase();
  $("strategies").innerHTML = exchangeTotals(displayed.strategies)
    .filter((e) => e.strategies.length)
    .map(
      (e) =>
        '<div class="venue-heading">' +
        e.id +
        " <span>" +
        money(e.pnl) +
        "</span></div>" +
        e.strategies
          .filter((s) =>
            (s.id + " " + s.name + " " + s.symbol)
              .toLowerCase()
              .includes(query),
          )
          .map(
            (s) =>
              '<button class="row ' +
              (s.id === selected ? "selected" : "") +
              '" data-id="' +
              s.id +
              '"><span>' +
              esc(s.name) +
              "<small>" +
              esc(s.symbol) +
              " · " +
              esc(healthMap()[s.id].state) +
              '</small></span><b class="' +
              (s.pnl < 0 ? "negative" : "positive") +
              '">' +
              money(s.pnl) +
              "</b></button>",
          )
          .join(""),
    )
    .join("");
}
function renderOperations() {
  const rows = operationRows(displayed, log, workspace.tab);
  $("operation-count").textContent = rows.length + " records";
  for (const b of $("operation-tabs").querySelectorAll("[data-tab]")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === workspace.tab));
    b.classList.toggle("active", b.dataset.tab === workspace.tab);
  }
  const columns =
    workspace.tab === "positions"
      ? [
          "Strategy",
          "Exchange",
          "Instrument",
          "State",
          "Position",
          "P&L (USD)",
          "Orders",
          "Fills",
          "Latency (ns)",
        ]
      : workspace.tab === "exceptions"
        ? ["Time (session s)", "Severity", "Type", "Entity", "Detail"]
        : [
            "Time (session s)",
            "Order ID",
            "Strategy",
            "Exchange",
            "Side",
            "Quantity",
            "Price",
            "Stage",
          ];
  $("operation-table").innerHTML =
    "<table><thead><tr>" +
    columns.map((c) => "<th>" + c + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows
      .slice(0, 100)
      .map((r) => {
        let cells;
        if (workspace.tab === "positions")
          cells = [
            r.strategy,
            r.venue,
            r.instrument,
            r.state,
            r.position,
            money(r.pnl),
            r.orders,
            r.fills,
            r.latency,
          ];
        else if (workspace.tab === "exceptions")
          cells = [
            r.time.toFixed(6),
            r.severity,
            r.type,
            r.strategyId || r.feed,
            r.message || eventText(r),
          ];
        else
          cells = [
            r.time.toFixed(6),
            r.orderId,
            r.strategyId,
            exchangeOf(
              displayed.strategies.find((s) => s.id === r.strategyId) || {},
            ),
            r.side,
            r.qty,
            r.price,
            r.type,
          ];
        return (
          "<tr " +
          (r.orderId
            ? 'data-order="' + esc(r.orderId) + '" tabindex="0"'
            : 'data-entity="' +
              esc(r.strategy || r.strategyId || r.feed) +
              '"') +
          ">" +
          cells.map((c) => "<td>" + esc(c ?? "—") + "</td>").join("") +
          "</tr>"
        );
      })
      .join("") +
    "</tbody></table>" +
    (rows.length
      ? ""
      : '<p class="empty-state">No observed ' +
        workspace.tab +
        " in the loaded window.</p>");
}
function applyTheme() {
  document.body.classList.toggle(
    "professional",
    workspace.theme === "professional",
  );
  document.body.classList.toggle("showcase", workspace.theme === "showcase");
  document.body.classList.toggle("cinematic", workspace.theme === "showcase");
  city.professional(workspace.theme === "professional");
  city.cameraFocus(workspace.autoFocus);
  city.bridgeScale(workspace.scale);
  $("theme").value = workspace.theme;
  $("bridge-scale").value = workspace.scale;
  $("camera-focus").checked = workspace.autoFocus;
  $("monitor-dock").hidden = !workspace.monitors;
  $("toggle-monitors").textContent = workspace.monitors
    ? "Hide monitors"
    : "Show monitors";
  $("cinematic").textContent =
    workspace.theme === "professional" ? "Table view" : "Engineering";
  saveWorkspace();
  window.dispatchEvent(new Event("resize"));
}
$("theme").onchange = (e) => {
  workspace.theme = e.target.value;
  applyTheme();
};
$("bridge-scale").onchange = (e) => {
  workspace.scale = e.target.value;
  city.bridgeScale(workspace.scale);
  saveWorkspace();
  draw(displayed);
};
$("camera-focus").onchange = (e) => {
  workspace.autoFocus = e.target.checked;
  city.cameraFocus(workspace.autoFocus);
  saveWorkspace();
};
$("inspector").addEventListener("click", (e) => {
  const p = e.target.closest("[data-inspector-pnl]"),
    d = e.target.closest("[data-inspector-detail]");
  if (p) openPnlWindow(p.dataset.inspectorPnl);
  else if (d) openStrategyWindow(d.dataset.inspectorDetail, "strategy");
});
$("strategy-search").oninput = renderStrategyTree;
$("operation-tabs").onclick = (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) {
    workspace.tab = b.dataset.tab;
    saveWorkspace();
    renderOperations();
  }
};
$("operation-table").onclick = (e) => {
  const order = e.target.closest("[data-order]"),
    entity = e.target.closest("[data-entity]");
  if (order) followOrder(order.dataset.order);
  else if (entity) select(entity.dataset.entity);
};
if (HOSTED_PREVIEW)
  for (const id of ["sessions", "refresh", "recording", "connect"]) {
    $(id).disabled = true;
    $(id).title = "Live backend is available in the downloadable local project";
  }
applyTheme();
function renderTicker(frame) {
  $("ticker-label").textContent =
    (frame.source || "imported").toUpperCase() + " / ACTIVITY";
  const items = log
    .slice(0, 22)
    .reverse()
    .map(
      (e) =>
        `<button ${e.orderId ? `data-order="${esc(e.orderId)}"` : ""}>${esc(eventText(e))}</button>`,
    );
  for (const s of frame.strategies)
    items.push(
      `<button data-entity="${s.id}">${exchangeOf(s)} / ${esc(s.name)} · ${esc(s.symbol)} · ${money(s.pnl)} · ${s.market?.price ?? "price not supplied"}</button>`,
    );
  if (!log.length)
    items.unshift(
      "<span>WAITING FOR OBSERVED EVENTS · " +
        esc(frame.source || "imported") +
        "</span>",
    );
  const html = items.join('<span class="ticker-separator">◆</span>');
  const track = $("ticker-track");
  if (track.dataset.content !== html) {
    track.dataset.content = html;
    track.innerHTML = `<div>${html}</div><div aria-hidden="true">${html}</div>`;
  }
}
function setHistory(cards) {
  historyCards = cards;
  city.histories(cards);
  $("historical-strip").innerHTML = cards
    .map(
      (c, i) =>
        `<button data-history="${i}"><span class="mini-city"><i></i><i></i><i></i><i></i></span><small>${esc(c.label)}</small><b class="${c.pnl < 0 ? "negative" : "positive"}">${money(c.pnl)}</b><em>${esc(c.source)}</em></button>`,
    )
    .join("");
}
async function openHistory(card) {
  if (card.remote) {
    $("sessions").value = card.id;
    await openRecording();
  } else {
    playing = false;
    await seek(card.time);
  }
  windows.open(
    "history",
    "RECORDED SNAPSHOT",
    kv("Capture", card.title || card.label) +
      kv("P&L snapshot", money(card.pnl)) +
      kv("Source", card.source),
  );
}
$("detail-windows").onclick = (e) => {
  const follow = e.target.closest("[data-follow]");
  if (follow) {
    followOrder(follow.dataset.follow);
    return;
  }
  const pnl = e.target.closest("[data-pnl-strategy]"),
    details = e.target.closest("[data-details]");
  if (pnl) {
    select("pnl-bridge-" + pnl.dataset.pnlStrategy);
    return;
  }
  if (details) {
    select(details.dataset.details);
    return;
  }
  const interior = e.target.closest("[data-interior]"),
    scanner = e.target.closest("[data-scanner]");
  if (interior) select("workstation-" + interior.dataset.interior);
  else if (scanner) openStrategyWindow(scanner.dataset.scanner, "scanner");
};
$("historical-strip").onclick = (e) => {
  const b = e.target.closest("[data-history]");
  if (b) openHistory(historyCards[Number(b.dataset.history)]);
};
$("ticker").onclick = (e) => {
  const order = e.target.closest("[data-order]"),
    entity = e.target.closest("[data-entity]");
  if (order) followOrder(order.dataset.order);
  else if (entity) select(entity.dataset.entity);
};
function stopOrder() {
  followGeneration++;
  activeOrder = null;
  orderEvents = [];
  city.stopFollow();
  $("order-panel").hidden = true;
}
function renderOrder() {
  if (!activeOrder) return;
  const rows = lifecycleRows(orderEvents, activeOrder);
  $("order-detail").innerHTML =
    `<h3>ORDER ${esc(activeOrder)}</h3><p class="muted">Observed timestamps in session seconds. Camera animation is illustrative. Missing stages are not inferred.</p>` +
    rows
      .map(
        (e) =>
          kv(e.type, e.time.toFixed(6) + "s") +
          kv(
            "Since previous observed stage",
            e.deltaUs === null ? "—" : e.deltaUs.toFixed(1) + " µs",
          ),
      )
      .join("");
}
async function followOrder(id) {
  const generation = ++followGeneration;
  try {
    let events;
    if (remote) {
      const data = await api(
        `/api/sessions/${encodeURIComponent(remote.id)}/orders?id=${encodeURIComponent(id)}`,
      );
      events = data.events;
    } else events = indexedEvents(local.frames);
    if (generation !== followGeneration) return;
    activeOrder = id;
    orderEvents = events.filter(
      (e) => e.orderId === id && (mode !== "live" || e.time <= displayed.time),
    );
    $("order-panel").hidden = false;
    renderOrder();
    city.followOrder(id, lifecycleRows(orderEvents, id));
  } catch (e) {
    $("notice").textContent = e.message;
  }
}
async function loadBookmarks() {
  const generation = ++bookmarkGeneration;
  try {
    let items;
    if (remote) {
      let events = [],
        after = -1,
        largest = null;
      for (let pages = 0; pages < 40; pages++) {
        const data = await api(
          `/api/sessions/${encodeURIComponent(remote.id)}/bookmarks?after=${after}`,
        );
        if (generation !== bookmarkGeneration) return;
        events.push(...data.events);
        largest = data.largest;
        after = data.next;
        if (!data.hasMore) break;
      }
      items = bookmarks([...events, ...(largest ? [largest] : [])]);
    } else items = bookmarks(indexedEvents(local.frames));
    if (generation !== bookmarkGeneration) return;
    bookmarkItems = items;
    $("bookmarks").innerHTML =
      '<option value="">Choose event</option>' +
      items
        .map(
          (e, i) =>
            `<option value="${i}">${esc(e.label)} · ${e.frameTime.toFixed(2)}s</option>`,
        )
        .join("");
  } catch (e) {
    $("notice").textContent = `Bookmarks unavailable: ${e.message}`;
  }
}
$("bookmarks").onchange = async (e) => {
  if (e.target.value === "") return;
  const mark = bookmarkItems[Number(e.target.value)];
  if (!mark) return;
  if (mode === "live") {
    stopLive();
    mode = "recording";
    frames = [];
    const data = await api("/api/sessions");
    remote = data.sessions.find((s) => s.id === remote.id) || remote;
    end = remote.end_time;
  }
  playing = false;
  await seek(mark.frameTime);
  if (mark.orderId) await followOrder(mark.orderId);
  else {
    select(mark.feed || mark.strategyId || "risk");
    $("order-panel").hidden = false;
    $("order-detail").innerHTML =
      `<h3>${esc(mark.label)}</h3>` +
      kv("Event time", mark.time.toFixed(6) + "s") +
      kv("Frame time", mark.frameTime.toFixed(6) + "s") +
      (mark.message ? `<p>${esc(mark.message)}</p>` : "") +
      (mark.expected !== undefined
        ? kv("Expected sequence", mark.expected)
        : "") +
      (mark.received !== undefined
        ? kv("Received sequence", mark.received)
        : "");
  }
};
$("stop-follow").onclick = stopOrder;
$("inspector").onclick = (e) => {
  const b = e.target.closest("[data-order]");
  if (b) followOrder(b.dataset.order);
};
$("events").onclick = (e) => {
  const b = e.target.closest("[data-order]");
  if (b) followOrder(b.dataset.order);
};
$("events").onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const b = e.target.closest("[data-order]");
    if (b) {
      e.preventDefault();
      followOrder(b.dataset.order);
    }
  }
};
$("strategies").onclick = $("feeds").onclick = (e) => {
  const b = e.target.closest("[data-id]");
  if (b) select(b.dataset.id);
};
$("home").onclick = () => city.home();
function cinema() {
  if (workspace.theme === "professional") {
    document.body.classList.toggle("data-expanded");
    $("cinematic").textContent = document.body.classList.contains(
      "data-expanded",
    )
      ? "3D workspace"
      : "Table view";
    return;
  }
  document.body.classList.toggle("cinematic");
  city.cinematic(document.body.classList.contains("cinematic"));
  $("cinematic").textContent = document.body.classList.contains("cinematic")
    ? "Engineering"
    : "Cinematic";
}
$("cinematic").onclick = cinema;
let touring = false;
$("tour").onclick = () => {
  touring = !touring;
  city.tour(touring);
  $("tour").setAttribute("aria-pressed", String(touring));
  $("tour").textContent = touring ? "Stop tour" : "Camera tour";
};
document.addEventListener("keydown", (e) => {
  if (
    workspace.theme === "showcase" &&
    e.key === "Tab" &&
    e.target === document.body
  ) {
    e.preventDefault();
    cinema();
  }
});
$("play").onclick = () => {
  if (!playing && time >= end)
    seek(mode === "local" ? frames[0].time : remote.start_time);
  playing = !playing;
  controls();
};
$("speed").onchange = (e) => (speed = Number(e.target.value));
$("scrub").step = ".1";
$("scrub").oninput = (e) => {
  playing = false;
  seek(Number(e.target.value));
};
$("demo").onclick = () => loadLocal(generateSession());
$("refresh").onclick = refresh;
$("recording").onclick = openRecording;
$("connect").onclick = watch;
$("eod").onclick = async () => {
  if (remote) {
    const id = remote.id;
    stopLive();
    const data = await api("/api/sessions");
    remote = data.sessions.find((s) => s.id === id);
    if (!remote) return;
    mode = "recording";
    frames = [];
    end = remote.end_time;
  }
  playing = false;
  await seek(end);
  $("mode").textContent = "END OF DAY";
};
$("export").onclick = () => {
  if (remote) {
    const a = document.createElement("a");
    a.href = `/api/sessions/${encodeURIComponent(remote.id)}/export`;
    a.click();
    return;
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(local)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "market-nexus-session.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("import").accept = ".json,.ndjson,application/json";
$("import").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024)
      throw Error(
        "Import limit is 25 MB; ingest larger files with adapters/bridge.py",
      );
    const text = await file.text();
    let s;
    try {
      s = JSON.parse(text);
    } catch {
      s = {
        version: 1,
        frames: text
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line)),
      };
    }
    loadLocal(s);
    $("notice").textContent =
      "File replay loaded; producer values are displayed as supplied.";
  } catch (err) {
    $("notice").textContent = `Import failed: ${err.message}`;
  }
  e.target.value = "";
};
let tickerOffset = 0,
  tickerPaused = false,
  manualTickerPaused = workspace.tickerPaused;
$("ticker-pause").onclick = () => {
  manualTickerPaused = !manualTickerPaused;
  workspace.tickerPaused = manualTickerPaused;
  saveWorkspace();
  $("ticker-pause").setAttribute("aria-pressed", String(manualTickerPaused));
  $("ticker-pause").textContent = manualTickerPaused
    ? "▶ Run ticker"
    : "Ⅱ Pause ticker";
};
$("ticker").onmouseenter = () => (tickerPaused = true);
$("ticker").onmouseleave = () => (tickerPaused = false);
$("ticker").onfocusin = () => (tickerPaused = true);
$("ticker").onfocusout = () => (tickerPaused = false);
$("city-navigation").innerHTML =
  '<option value="state">Market Nexus state</option>' +
  EXCHANGES.map(
    (e) => '<option value="' + e.id + '">' + e.id + " city</option>",
  ).join("");
$("city-navigation").onchange = (e) =>
  e.target.value === "state" ? city.home() : select("city-" + e.target.value);
let previous = performance.now();
function tick(now) {
  const dt = Math.min((now - previous) / 1000, 0.25);
  previous = now;
  const track = $("ticker-track"),
    width =
      track.firstElementChild?.getBoundingClientRect().width || innerWidth;
  if (!tickerPaused && !manualTickerPaused)
    tickerOffset = (tickerOffset + dt * 55) % width;
  track.style.transform = "translate3d(" + -tickerOffset + "px,0,0)";
  if (mode !== "live" && playing && !loading) {
    const target = Math.min(time + dt * speed, end);
    if (mode === "recording" && target > frames.at(-1)?.time) {
      seek(target);
    } else {
      const f = frameAt(frames, target);
      if (f && f.seq !== displayed.seq) {
        const crossed = frames
          .filter((x) => x.time > time && x.time <= target)
          .flatMap((x) => x.events);
        log = [...crossed].reverse().concat(log).slice(0, 60);
        draw(f, crossed);
      }
      time = target;
      $("scrub").value = time;
      if (time >= end) {
        playing = false;
        controls();
      }
    }
  } else if (mode === "live" && lastReceived && now - lastReceived > 3000)
    $("connection").textContent = "STALE / NO UPDATES";
  requestAnimationFrame(tick);
}
loadLocal(local);
seek(30);
if (workspace.theme === "showcase") openStrategyWindow("mm", "strategy");
refresh();
setInterval(refresh, 15000);
setInterval(() => {
  refreshHealth();
  renderProvenance();
  inspect();
}, 1000);
setInterval(() => {
  if (mode === "live") loadBookmarks();
}, 10000);
requestAnimationFrame(tick);
window.addEventListener("beforeunload", stopLive);
