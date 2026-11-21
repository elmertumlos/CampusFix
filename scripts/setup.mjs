import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

try {
  const password = randomBytes(18).toString("base64url");
  await writeFile(".dev.vars", 'STAFF_USERNAME="staff"\nSTAFF_PASSWORD="' + password + '"\n', {
    flag: "wx",
    mode: 0o600
  });
  console.log("Created local staff credentials in .dev.vars.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Using the existing local staff credentials in .dev.vars.");
}

const migration = spawnSync(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local"
], { stdio: "inherit" });
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exitCode = migration.status ?? 1;
