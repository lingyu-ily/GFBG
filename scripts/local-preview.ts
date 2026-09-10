import EmbeddedPostgres from "embedded-postgres";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
await mkdir(".local", { recursive: true });
const settingsPath = resolve(".local/preview-settings.json");
let settings: { password: string; initialized: boolean };
try {
  settings = JSON.parse(await readFile(settingsPath, "utf8"));
} catch {
  settings = { password: randomBytes(24).toString("hex"), initialized: false };
}
const port = Number(process.env.PREVIEW_PORT || 3000);
const pgPort = Number(process.env.PREVIEW_PG_PORT || 55439);
const database = new EmbeddedPostgres({
  databaseDir: resolve(".local/preview-pg"),
  user: "postgres",
  password: settings.password,
  port: pgPort,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});
if (!settings.initialized) await database.initialise();
await database.start();
if (!settings.initialized) {
  await database.createDatabase("tablefolk_preview");
  settings.initialized = true;
  await writeFile(settingsPath, JSON.stringify(settings), { mode: 0o600 });
}
const child = spawn(process.execPath, ["dist/server/index.js"], {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(port),
    PUBLIC_URL: `http://localhost:${port}`,
    DATABASE_URL: `postgresql://postgres:${settings.password}@127.0.0.1:${pgPort}/tablefolk_preview`,
    AUTO_MIGRATE: "true",
    SMTP_HOST: "",
    SMTP_FROM: "",
    TRUST_PROXY_HOPS: "0",
  },
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill();
  await database.stop();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
child.on("exit", async (code) => {
  await stop();
  process.exitCode = code || 0;
});
console.info(
  `本機預覽：http://localhost:${port}（獨立開發資料庫，SMTP 未啟用）`,
);
