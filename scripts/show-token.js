import { readFileSync } from "node:fs";
import { resolve } from "node:path";
try {
  console.log(
    readFileSync(
      resolve(process.env.NEXUS_DATA_DIR || "data", "ingest-token"),
      "utf8",
    ).trim(),
  );
} catch {
  console.error(
    "Start npm start once to create the local ingestion credential.",
  );
  process.exitCode = 1;
}
