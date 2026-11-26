import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const configPath = "dist/server/wrangler.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const databaseId = config.d1_databases?.find((database) => database.binding === "DB")?.database_id;
if (!databaseId || databaseId === "00000000-0000-4000-8000-000000000000") {
  throw new Error("Set TAKEAWAY_D1_ID to the Cloudflare database UUID, then run npm run build.");
}

for (const args of [["d1", "migrations", "apply", "DB", "--remote"], ["deploy"]]) {
  const result = spawnSync(process.execPath, [
    "./node_modules/wrangler/bin/wrangler.js", ...args, "--config", configPath,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
