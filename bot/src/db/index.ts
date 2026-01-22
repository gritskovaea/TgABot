import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function waitForDb(
  retries = 10,
  delayMs = 2000
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      lastError = err;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}