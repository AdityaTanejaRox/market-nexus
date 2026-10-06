# Market Nexus — frontend v1

A complete local Three.js trading-city demo. All built-in prices, strategies,
P&L, positions, fills and latency values are synthetic. This is a visualization
project, not a trading engine or a production CME/iLink integration.

## Run

Install Node.js 22.12+ (tested with Node 24.19).
Unzip, open a terminal in `market-nexus`, then:

```
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173).
In a second terminal in the same folder:

```
npm run server
```

Click Connect WS and accept `ws://127.0.0.1:8787`.
The demo server sends one complete frame per second. It binds to loopback,
accepts no trading commands and disconnects slow consumers.
The frontend also works without the server, using a deterministic local replay.

## Controls

- Drag: orbit; wheel/pinch: zoom; click a tower: inspect.
- Strategy buttons select and focus a tower. Reset camera returns to overview.
- Cinematic hides engineering panels. Tab toggles it when the page body has focus;
  Tab continues normal keyboard navigation when a control has focus.
- Pause/Play, speed and scrub control replay only.
- End of day freezes the final recorded frame; it does not close a market session.
- Export writes the loaded/captured session as JSON. Import validates a replay.
- New demo session returns to the original deterministic simulation.
- A stale or disconnected live view holds its last state; it does not invent data.

Tower height shows absolute P&L magnitude, capped for readability. Magenta
indicates negative P&L; cyan indicates nonnegative P&L, not investment quality.
Animated order stages are illustrative, not a time-accurate latency trace.
All windows are instanced geometry; active animation objects are capped at 80.
Rendering uses a capped pixel ratio, bloom, orbit controls and WebGL.

## Files

- `index.html`: accessible controls and data-panel shells.
- `src/main.js`: replay clock, inspectors, event stream, import/export, WS client.
- `src/city.js`: floating city, towers, feed buildings, links and animations.
- `src/model.js`: deterministic demo, frame validation and replay lookup.
- `src/style.css`: responsive engineering/cinematic layout.
- `server/index.js`: optional read-only synthetic WebSocket server.
- `test/model.test.js`: deterministic replay and protocol invariants.
- `dist/`: prebuilt frontend (serve over HTTP; do not double-click index.html).
- `package-lock.json`: pinned installation graph. Use npm ci.

## Build and verify

```
npm test
npm run build
npm run preview
```

The production bundle includes Three.js; no runtime CDN fetch is required.
The zip excludes node_modules; npm ci requires network access. A prebuilt dist
is included, so it may also be served by any static HTTP server without npm.
The build and automated model/WS checks were run; interactive browser QA was
not available in the authoring environment. A device needs WebGL support.

## Wire protocol v1

Each WebSocket text message is a complete JSON frame:

```
{
  "version": 1,
  "seq": 1,
  "time": 0,
  "strategies": [ ...all five strategy objects... ],
  "feeds": [ ...feed A and feed B... ],
  "events": [ ...events observed since the previous frame... ]
}
```

`seq` is the telemetry frame sequence, not the feed packet sequence. `time` is
seconds since the capture epoch, not Unix nanoseconds. Sequences and times must
increase within one connection/session. Reconnect can start a new capture.
Strategy IDs are `mm`, `arb`, `mom`, `vwap`, `rev`; v1's layout is fixed to five
strategies and feeds A/B. Add layout discovery before using a dynamic fleet.
See `STRATEGIES`, `validateFrame` and `generateSession` for exact field shapes.
P&L is USD display units, position/quantity is contracts and latency is ns.
Real adapters must supply currency/instrument conversion before populating v1;
the browser's numbers must not serve as authoritative accounting values.

Supported events: ORDER_CREATED, RISK_PASSED, RISK_REJECTED, ORDER_SENT,
ORDER_ACK, FILL, FEED_GAP and FEED_RECOVERED. Events have unique IDs, a time,
and order events carry orderId, strategyId, side, qty and price. Event animation
sampling is allowed; the full strategy/feed state is required in every frame.
At most 200 events per frame, 128 KB per WS message, 12,000 frames per import
and 25 MB per imported file. Live capture retains the latest 12,000 frames.
Repeated/out-of-order frames are rejected; skipped sequences apply fresh state
and report missing intermediate event animations. There is no audit guarantee.

## Connecting the real C++ system later

Keep this read-only observer outside your trading control path. Prefer one
bounded SPSC queue per producer thread (SPSC does not support multiple producers).
Use fixed-size events, no JSON or disk I/O in the trading thread, and explicit
try-push failure counters. The worker drains queues, aggregates and serializes
complete visualization frames. Periodic authoritative snapshots repair state
when telemetry events were dropped; UI backpressure must never reach trading.

Use the existing lossless journal for audit/replay. Do not silently convert it
into a lossy visualization queue. A journal tailer is also a valid first adapter
if your existing logging already has safe complete-record framing and asynchronous
writes; it must buffer incomplete records and handle rotations/truncations.

Telemetry is not free: measure overhead with/without it, isolate consumer CPU
resources where needed, and measure contention/cache effects. There are no
nanosecond performance claims for this demo. Replay from PCAP alone contains
market data, not orders/fills: actual order reconstruction needs the execution
journal or an explicitly labeled simulation.

Before remote hosting: WSS, authentication, origin policy, access control,
server-side schema enforcement, bounded resources, currency metadata and real
snapshot sourcing are required. This demo provides no order placement, cancel,
risk-limit editing, authentication or durable server-side storage.
