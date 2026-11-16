import "dotenv/config";
import { Pool } from "pg";
import { runMigrations } from "../scripts/migrate";

/** Fresh schema for every test run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://wakeel:wakeel_dev_pw@localhost:5432/wakeel_test";
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await pool.end();
  await runMigrations(url);
}
