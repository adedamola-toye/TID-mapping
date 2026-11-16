/**
 * DEVELOPMENT ONLY: drop and recreate the schema, migrate and seed.
 * Refuses to run when NODE_ENV=production.
 */
import "dotenv/config";
import { Pool } from "pg";
import { runMigrations } from "./migrate";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("db:reset is disabled in production.");
  const url = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await pool.end();
  await runMigrations(url);
  const { seed } = await import("./seed");
  await seed();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
