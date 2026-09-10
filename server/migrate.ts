import { readdir, readFile } from "node:fs/promises";
import { pool, transaction } from "./db.js";
export async function migrate() {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7241039)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await db.query("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );
    for (const name of (await readdir("migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (done.has(name)) continue;
      await db.query(await readFile(`migrations/${name}`, "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      console.info(`已套用資料庫遷移 ${name}`);
    }
  });
}
if (/[\\/]migrate\.(ts|js)$/.test(process.argv[1] || "")) {
  migrate()
    .then(() => pool.end())
    .catch(async () => {
      console.error("資料庫遷移失敗，請檢查連線、權限與版本。");
      await pool.end();
      process.exitCode = 1;
    });
}
