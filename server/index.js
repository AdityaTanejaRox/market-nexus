import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createApp } from "./app.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = createApp({
  dataDir: process.env.NEXUS_DATA_DIR || resolve(root, "data"),
  distDir: resolve(root, "dist"),
  token: process.env.NEXUS_INGEST_TOKEN,
});
app.server.listen(Number(process.env.PORT || 8787), "127.0.0.1", () =>
  console.log(
    `Market Nexus: http://127.0.0.1:${app.server.address().port}\nIngestion credential: ${app.tokenPath}\nNo generated trading data is emitted by the server.`,
  ),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
