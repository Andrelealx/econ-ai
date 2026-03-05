import { runMigrations } from "../db/migrate";
import { pool } from "../db/pool";

async function main(): Promise<void> {
  await runMigrations();
  console.log("Migrations concluida.");
}

main()
  .catch((error) => {
    console.error("Erro na migration", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
