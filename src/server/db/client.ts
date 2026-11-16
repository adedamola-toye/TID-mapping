import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { config } from "../config";

export type DB = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query API as the db. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __wakeelPool?: Pool; __wakeelDb?: DB };

export function getPool(): Pool {
  if (!globalForDb.__wakeelPool) {
    globalForDb.__wakeelPool = new Pool({
      connectionString: config().DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
    });
  }
  return globalForDb.__wakeelPool;
}

export function getDb(): DB {
  if (!globalForDb.__wakeelDb) {
    globalForDb.__wakeelDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__wakeelDb;
}

export async function closeDb() {
  await globalForDb.__wakeelPool?.end();
  globalForDb.__wakeelPool = undefined;
  globalForDb.__wakeelDb = undefined;
}

export { schema };
