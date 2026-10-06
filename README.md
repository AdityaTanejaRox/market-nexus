# Market Nexus v4 — health, bookmarks and order follow

A local, read-only 3D telemetry application with authenticated ingestion,
persistent SQLite recordings, live WebSocket viewing, and paged historical
playback. The server starts empty and never fabricates trades. Simulations and
the C++ example are explicitly labeled. No exchange credentials are included.

## New in v4

- Health: gray idle/waiting, amber degraded, purple stale, red stopped/offline/
  disconnected, cyan healthy. Negative P&L beams remain magenta when health is
  otherwise normal. Towers and feed panels show their last snapshot time in
  session seconds. Live stream receipt age is shown on screen. Paused recordings
  do not turn stale just because wall-clock time passes.
- Optional per-entity `updatedAt` is the producer's last observation time in
  session seconds (0 <= updatedAt <= frame.time). Without it, freshness uses
  the complete frame time; it does not claim to know when a strategy last changed.
- Bookmarks: choose a feed gap/recovery, risk rejection/warning/limit breach, or
  largest fill by contract quantity. Selection pauses replay and seeks to the
  containing frame; choosing from live switches to stored playback. Largest
  quantity is not largest financial notional across unlike instruments.
- Stored sessions get an indexed event table, backfilled automatically once for
  existing recordings. Bookmark queries are paginated, and order lookup covers
  the stored session rather than the browser's current 500-frame window. The UI
  loads up to 20,000 alert bookmarks and the largest fill for resource bounds.
- Follow: click an animated order trail, click an order in the event stream, or
  choose Follow this order in a strategy inspector. A panel shows the recorded
  stage timestamps and time differences between observed stages. The camera
  follows sequential illustrative stage animations; missing stages are never
  invented. Camera timing is not execution latency. Drag to interrupt tracking;
  Close / stop following dismisses the panel. Order lookup returns up to 2,000
  event records; lifecycle duplicate IDs are suppressed in the displayed table.
- New optional events RISK_WARNING/RISK_LIMIT_BREACHED carry id, strategyId,
  time and message (max 240 characters); they do not need an order ID. Existing
  C++ producers still work without emitting these optional warnings.

## Visual redesign

The default view is now the floating city: 233 surrounding buildings with
procedurally illuminated facades, five tiered strategy skyscrapers, rotating
crown rings, vertical beams, a luminous exchange vault and armillary, layered
floating foundations, perimeter railings, three satellite islands, suspension
bridges, nebula dust and stars. Holographic strategy panels show source P&L,
position, orders/fills and a recent P&L sparkline. Feed labels show source health,
packet sequence and gaps. Actual observed order events draw luminous comet
trails; fills and feed events trigger expanding rings. Ambient orbital lights
are decorative and do not represent orders.

The city opens in cinematic mode. Click Engineering to reveal the full data
panels and file/session controls; click Cinematic to return. Camera tour performs
an orbit; dragging the scene stops it. Clicking a strategy flies toward its
city block; Reset camera returns to overview. Updated UI keeps playback/session
controls in a compact floating strip. No image assets or runtime CDN are needed.

This is a new procedural interpretation of the supplied reference, not the
creator's original meshes/assets or an exact pixel reproduction. Automated
layout checks validate dense, deterministic geometry and clear landmark centers.
Interactive browser rendering was unavailable; visual fidelity and GPU frame
rate are not verified in this environment.

## Start — Windows, Linux or macOS

Requires Node.js 22.13+ (tested on 24.19) and npm. Python 3.9+ is required only
for the log bridge. A C++17 compiler is required only for the C++ adapter.

In the extracted `market-nexus` directory:

```
npm ci
npm start
```

Open **http://127.0.0.1:8787**. Prebuilt frontend files are included. After editing
source, run `npm run build` before `npm start`. For development, run `npm run dev`
in another terminal; Vite proxies the API and WebSocket to the backend.

On first startup the server creates `data/ingest-token` and
`data/sessions.sqlite`. Keep the data directory between restarts. It contains
private telemetry and an ingestion credential; it is excluded from the ZIP.
Do not start two server instances using the same data directory.

## Quick end-to-end demonstration

Keep `npm start` running. In another terminal:

```
npm run demo
```

Refresh sessions in the dashboard, select the session labeled `[demo]`, and
click **Watch live**. This explicitly synthetic publisher sends 121 snapshots
at 10 snapshots/second. Select **Open recording** to replay the persisted data.
Export streams an NDJSON file from the server without loading the whole session
into browser memory. The local demo button is independent of the server.

## Real data ingestion

The server accepts complete visualization state at `POST /api/ingest`:

```
Authorization: Bearer <contents of data/ingest-token>
Content-Type: application/json
```

The body is `{sessionId, label, source, frame}`. Source is `telemetry`, `example`
or `demo`. A session ID is 1–64 ASCII letters/digits/underscores/hyphens, starting
with a letter/digit. Use a new ID for each producer epoch/run. Label and source
are immutable for the session. The producer owns increasing frame sequence and
elapsed time. Acknowledgment means the frame was committed to SQLite with FULL
synchronous mode; visualization is broadcast afterward. Identical retries are
idempotent. Conflicting retries or decreasing sequence/time return HTTP 409.

Every frame contains version=1, seq, time, source, five strategies, two feeds,
and an events array. Optional dropped is the cumulative producer/aggregation
drop count. See `src/model.js` for the exact validator and field definitions.
The strategy slots are mm, arb, mom, vwap and rev. Names and symbols are supplied
by the producer; map your five initial strategy instances to these slots.
The current layout is limited to five slots; it is not a dynamic fleet manager.

State is authoritative for this visualization. Events are sampled animation
hints. Send periodic complete snapshots sourced from your engine; dropped event
hints must not corrupt positions, P&L or cumulative counts. No browser value is
an authoritative trading/accounting source. P&L is display USD, prices are
instrument display units, quantity/position are integral contracts and latency
is nanoseconds. Perform currency/instrument normalization in your adapter.
Numbers represented as integer counters must fit JavaScript safe integer range.

## Log bridge — already framed normalized telemetry

For a completed NDJSON recording:

```
python adapters/bridge.py capture.ndjson --session my-capture --source telemetry
```

For a growing recording:

```
python adapters/bridge.py capture.ndjson --session my-live-run --source telemetry --follow
```

On some systems use `python3` instead of `python`. The bridge sends only complete
newline-terminated records, buffers an incomplete tail, retries temporary
network/server failures, and detects rotation/truncation. It stops on a permanent
error and never silently skips invalid records. Restarting it from the beginning
with the same ID safely retries identical committed frames. Do not reuse a
session ID for another recording. Use `--label`, `--url` and `--token-file` as
needed. NEXUS_INGEST_TOKEN can provide the credential through the environment.

This is a reader for the normalized frame format, not a parser for your unknown
existing trading log format. A mapper is needed for existing custom text logs,
CME PCAPs or execution journals. PCAP market data alone does not contain your
strategy orders, fills or P&L.

## C++ integration

`adapters/cpp/telemetry.hpp` contains a bounded, fixed-size SPSC queue and a
cold-thread aggregator/NDJSON writer. Each producer thread must own a separate
queue. Initialize queues before trading starts. Push fixed-size `nexus::Event`
values with `try_push`; never write JSON, disk or HTTP from the producer.

StrategySnapshot events carry authoritative P&L, position, orders, fills,
latency and state. FeedSnapshot events carry authoritative feed sequence, gaps
and health. Order lifecycle events provide animation hints. Snapshot events
repair dropped hints; emit them periodically from the authoritative engine.
Aggregator::drain may be called on multiple producer queues by one worker.
Then call write_frame from that worker every 100–1000 ms into a dedicated
telemetry NDJSON file, read by the Python bridge. Prices and P&L in the C++ event
are signed integer millionths; serialization converts to display units.
Use one monotonic capture epoch for event timestamp_ns and frame elapsed_ns.

Queue capacity is 4096 slots with 4095 usable entries. It never waits for free
space; failed pushes increment a drop counter. Required atomics are checked to
be lock-free on the compilation target. The aggregator caps animation hints at
200/frame and counts omissions. Writer/network failures affect only observer
workers. Do not route your lossless audit journal through this lossy queue.
Measure telemetry overhead in your actual deployment; it is not zero.

Build the synthetic C++ integration example with CMake:

```
cmake -S adapters/cpp -B build-cpp
cmake --build build-cpp --config Release
ctest --test-dir build-cpp -C Release --output-on-failure
```

Linux/macOS binary: `build-cpp/nexus_example`.
Windows/MSVC binary: `build-cpp/Release/nexus_example.exe`.

Run the example to generate a 10-second capture:

```
build-cpp/nexus_example example.ndjson
python adapters/bridge.py example.ndjson --session cpp-example-1 --source example
```

On Windows substitute the `.exe` path above. To watch as it writes, start the
bridge with `--follow` in another terminal after the file appears. Stop the
bridge with Ctrl+C when the example completes. Actual engine integration uses
source `telemetry`; the bundled example is synthetic and declares `example`.

Linux without CMake can compile directly:

```
mkdir -p build-cpp
g++ -std=c++17 -O2 -pthread adapters/cpp/example.cpp -o build-cpp/nexus_example
g++ -std=c++17 -O2 -pthread adapters/cpp/test.cpp -o build-cpp/nexus_queue_test
./build-cpp/nexus_queue_test
```

## Application behavior

- Drag to orbit, wheel to zoom, click towers/strategy/feed rows to inspect.
- Strategy labels show P&L/position; height shows capped absolute P&L magnitude.
- Cyan/amber feed beams show healthy/degraded; magenta strategy beams show losses.
- Animated order stages are illustrative, not measured latency traces.
- Inspectors show supplied counters and recently observed order lifecycle.
- P&L charts cover the currently loaded window; worker bars show supplied latency.
- Stored replay seeks through indexed pages of 500 frames, rather than loading a
  whole day. End of day displays the latest persisted frame; it sends no commands.
- Live subscriptions receive the latest full-state snapshot then new frames.
- Socket closure retries automatically. Three seconds without frames is stale.
- Frame sequence gaps are visible; complete snapshots repair displayed state.
- Export uses persisted sessions. JSON/NDJSON local import is limited to 25 MB
  and 12,000 frames; ingest larger captures through the Python bridge.

## Operations and boundaries

This release binds to 127.0.0.1 only. Ingestion is token-protected; read access is
local-machine access with Host/Origin checks. It is not an Internet multi-user
authentication service. Use the local URL above rather than exposing the port.
The frontend is served by the same process and needs no runtime CDN.

Storage defaults to a 2 GiB quota; ingestion returns 507 when it is exhausted.
There is no automatic deletion of recorded sessions. Back up SQLite after a
clean shutdown (including relevant data files). Export recordings before
archiving/removing an entire stopped data directory. Frames are limited to
128 KiB, animation hints to 200/frame, browsers to 32 connections, and outgoing
WS buffering to 256 KiB/client. Slow clients are disconnected. Feed counters
are distinct from telemetry frame sequences. Native SQLite errors fail ingestion;
trading continues independently.

Optional environment variables: PORT, NEXUS_DATA_DIR, NEXUS_INGEST_TOKEN.
If using NEXUS_INGEST_TOKEN, the bridge uses it too; the generated token file
need not match an environment override. npm run token prints the token file only.

Not included: order placement/cancel, risk-control writes, exchange connectivity,
a trading strategy, broker credentials, a CME/iLink decoder, arbitrary-log mapping,
remote authentication, or a managed hosted backend. These require your actual
engine/source/environment. The supported result here is the complete observer
application and its tested producer/ingestion/replay interfaces.

## Validation

```
npm test
npm run build
```

Automated tests cover deterministic replay, bad frame rejection, feed gaps,
fill counts, authentication, body size, origin/host checks, replay seek/export,
idempotency, sequence conflicts, restart recovery, WS snapshots and storage quota.
The C++ queue test exercises FIFO concurrency and saturation. After compiling the
C++ example on Linux, `node scripts/check-cpp-pipeline.js` tests the complete
C++ → appended file → Python bridge → SQLite → WebSocket path.

Interactive browser QA was unavailable in the authoring environment. Build,
backend and C++/Python integration tests were executed. Native Node SQLite may
emit an experimental warning on some Node releases. The chart/3D renderer needs
WebGL; data panels remain available if WebGL initialization fails.
