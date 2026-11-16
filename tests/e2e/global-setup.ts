import { execSync } from "node:child_process";

/** Reset + migrate + seed the dedicated e2e database before the browser tests run. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://wakeel:wakeel_dev_pw@localhost:5432/wakeel_e2e";
  execSync("npx tsx --conditions=react-server scripts/reset.ts", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: "development" },
  });
}
