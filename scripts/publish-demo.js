import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSession } from "../src/model.js";
const token =
  process.env.NEXUS_INGEST_TOKEN ||
  readFileSync(
    resolve(process.env.NEXUS_DATA_DIR || "data", "ingest-token"),
    "utf8",
  ).trim();
const sessionId = `demo-${Date.now()}`,
  label = "Synthetic demo";
console.log(`Publishing explicitly simulated session ${sessionId}`);
for (const frame of generateSession(42, 120).frames) {
  const r = await fetch("http://127.0.0.1:8787/api/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionId, label, source: "demo", frame }),
  });
  if (!r.ok) throw Error(await r.text());
  await new Promise((resolve) => setTimeout(resolve, 100));
}
console.log("Demo persisted. Refresh sessions in the dashboard.");
