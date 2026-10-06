import "./style.css";
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
let city,
  connected = false,
  activeOrder = null,
  orderEvents = [],
  bookmarkItems = [],
  bookmarkGeneration = 0,
  followGeneration = 0;
try {
  city = createCity($("world"), select, followOrder);
  city.cinematic(true);
} catch (e) {
  $("notice").textContent = `WebGL unavailable: ${e.message}`;
  city = {
    update() {},
    emit() {},
    clearEffects() {},
    focus() {},
    home() {},
    cinematic() {},
    tour() {},
    health() {},
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
  selected = id;
  city.focus(id);
  inspect();
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
  $("inspector").innerHTML = html;
}
function draw(frame, events = []) {
  displayed = frame;
  $("scene-source").textContent =
    `${(frame.source || "imported").toUpperCase()} / ${mode.toUpperCase()}`;
  city.update(frame, healthMap());
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
  $("strategies").innerHTML = [...frame.strategies]
    .sort((a, b) => b.pnl - a.pnl)
    .map(
      (s) =>
        `<button class="row" data-id="${s.id}"><span>${esc(s.name)}<small>${esc(s.symbol)} · ${s.state}</small></span><b class="${s.pnl >= 0 ? "positive" : "negative"}">${money(s.pnl)}</b></button>`,
    )
    .join("");
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
  if (e.key === "Tab" && e.target === document.body) {
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
let previous = performance.now();
function tick(now) {
  const dt = Math.min((now - previous) / 1000, 0.25);
  previous = now;
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
refresh();
setInterval(refresh, 15000);
setInterval(() => {
  refreshHealth();
  inspect();
}, 1000);
setInterval(() => {
  if (mode === "live") loadBookmarks();
}, 10000);
requestAnimationFrame(tick);
window.addEventListener("beforeunload", stopLive);
