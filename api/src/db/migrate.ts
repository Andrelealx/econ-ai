import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool";

export async function runMigrations(): Promise<void> {
  const sqlPath = path.resolve(__dirname, "../../sql/schema.sql");
  const sql = await fs.readFile(sqlPath, "utf8");
  await pool.query(sql);
}
