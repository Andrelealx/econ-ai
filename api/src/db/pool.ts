import { Pool } from "pg";
import { env } from "../config";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 20_000
});
