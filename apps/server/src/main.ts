import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createDb } from "./db/pool.js";
import { defaultMigrationsDir, loadMigrations, migrate } from "./db/migrate.js";

/**
 * Process entry point: validate env, apply migrations, listen, and shut down gracefully on SIGTERM/SIGINT
 * (docker stop sends SIGTERM and waits 10 s by default; we close within that).
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const migrations = await loadMigrations(defaultMigrationsDir());
  // The pool exists before the app (migrations need it), so its error sink is wired once the logger exists.
  const sink: { log?: (error: Error) => void } = {};
  const db = createDb({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    onIdleError: (error) => sink.log?.(error),
  });
  const app = await buildApp(config, { db, expectedMigration: migrations.at(-1)?.name ?? null });
  sink.log = (error) => app.log.warn({ err: error }, "idle database connection error");

  if (process.env["MIGRATE_ON_START"] !== "false") {
    const result = await migrate(db.pool, migrations);
    app.log.info({ applied: result.applied, current: migrations.at(-1)?.name }, "migrations checked");
  }

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, "shutting down");
    const force = setTimeout(() => process.exit(1), 8_000);
    force.unref();
    void app
      .close()
      .then(() => db.destroy())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, "shutdown failed");
        process.exit(1);
      });
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
