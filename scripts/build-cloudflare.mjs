import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const databaseId = process.env.TAKEAWAY_D1_ID?.trim();
if (databaseId && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(databaseId)) {
  throw new Error("TAKEAWAY_D1_ID must be the D1 database UUID from Cloudflare.");
}

const build = spawnSync(process.execPath, ["./node_modules/vite/bin/vite.js", "build"], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const path = "dist/server/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));
const binding = config.d1_databases.find((database) => database.binding === "DB");
if (!binding) throw new Error("The built Worker is missing its DB binding.");
if (databaseId) binding.database_id = databaseId;
// Wrangler resolves D1 migrations relative to the generated config.
binding.migrations_dir = "../../drizzle";
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
