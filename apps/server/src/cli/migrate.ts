import { createDb } from "../db/pool.js";
import { defaultMigrationsDir, loadMigrations, migrate } from "../db/migrate.js";

/** `npm run migrate -w @pl/server`: applies pending migrations to DATABASE_URL and exits. */
async function run(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required.");
  const db = createDb({ connectionString: url, max: 1, applicationName: "pixel-life-migrate" });
  try {
    const result = await migrate(db.pool, await loadMigrations(defaultMigrationsDir()));
    process.stdout.write(`applied: ${result.applied.join(", ") || "none"}\n`);
  } finally {
    await db.destroy();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
