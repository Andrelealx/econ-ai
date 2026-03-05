import bcrypt from "bcryptjs";
import { runMigrations } from "../db/migrate";
import { pool } from "../db/pool";
import { createId } from "../utils/id";

async function main(): Promise<void> {
  await runMigrations();

  const email = "demo@econ-ai.app";
  const password = "Demo@1234";

  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);

  let userId = existing.rows[0]?.id;

  if (!userId) {
    userId = createId();
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, monthly_income, risk_profile)
       VALUES ($1, 'Usuario Demo', $2, $3, 12000, 'moderado')`,
      [userId, email, hash]
    );
  }

  const accountRows = await pool.query<{ id: string; type: string }>(
    `SELECT id, type FROM accounts WHERE user_id = $1`,
    [userId]
  );

  let checkingId = accountRows.rows.find((row) => row.type === "checking")?.id;
  let brokerageId = accountRows.rows.find((row) => row.type === "brokerage")?.id;

  if (!checkingId) {
    checkingId = createId();
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, type, currency, balance)
       VALUES ($1, $2, 'Conta corrente', 'checking', 'BRL', 5600)`,
      [checkingId, userId]
    );
  }

  if (!brokerageId) {
    brokerageId = createId();
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, type, currency, balance)
       VALUES ($1, $2, 'Corretora', 'brokerage', 'BRL', 18000)`,
      [brokerageId, userId]
    );
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthRef = `${yyyy}-${mm}`;

  const sampleTransactions: Array<{
    type: "income" | "expense";
    category: string;
    description: string;
    amount: number;
    occurredOn: string;
    accountId: string;
  }> = [
    {
      type: "income",
      category: "salario",
      description: "Salario mensal",
      amount: 12000,
      occurredOn: `${monthRef}-05`,
      accountId: checkingId
    },
    {
      type: "expense",
      category: "moradia",
      description: "Aluguel",
      amount: 2800,
      occurredOn: `${monthRef}-06`,
      accountId: checkingId
    },
    {
      type: "expense",
      category: "alimentacao",
      description: "Supermercado",
      amount: 1350,
      occurredOn: `${monthRef}-07`,
      accountId: checkingId
    },
    {
      type: "expense",
      category: "transporte",
      description: "Combustivel",
      amount: 650,
      occurredOn: `${monthRef}-08`,
      accountId: checkingId
    },
    {
      type: "expense",
      category: "lazer",
      description: "Assinaturas e streaming",
      amount: 300,
      occurredOn: `${monthRef}-09`,
      accountId: checkingId
    }
  ];

  for (const item of sampleTransactions) {
    const exists = await pool.query<{ id: string }>(
      `SELECT id
       FROM transactions
       WHERE user_id = $1
         AND description = $2
         AND occurred_on = $3::date
       LIMIT 1`,
      [userId, item.description, item.occurredOn]
    );

    if (exists.rowCount) {
      continue;
    }

    await pool.query(
      `INSERT INTO transactions (id, user_id, account_id, type, category, description, amount, occurred_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)`,
      [createId(), userId, item.accountId, item.type, item.category, item.description, item.amount, item.occurredOn]
    );
  }

  const sampleBudgets = [
    ["moradia", 3000],
    ["alimentacao", 1200],
    ["transporte", 700],
    ["lazer", 400]
  ] as const;

  for (const [category, monthlyLimit] of sampleBudgets) {
    await pool.query(
      `INSERT INTO budgets (id, user_id, category, month_ref, monthly_limit)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, category, month_ref)
       DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit`,
      [createId(), userId, category, monthRef, monthlyLimit]
    );
  }

  const goalExists = await pool.query<{ id: string }>(
    `SELECT id FROM goals WHERE user_id = $1 AND name = 'Reserva de emergencia' LIMIT 1`,
    [userId]
  );

  if (!goalExists.rowCount) {
    await pool.query(
      `INSERT INTO goals (id, user_id, name, target_amount, current_amount, target_date, status)
       VALUES ($1, $2, 'Reserva de emergencia', 30000, 18500, NOW() + INTERVAL '8 months', 'active')`,
      [createId(), userId]
    );
  }

  const positions = [
    ["PETR4", "Petrobras PN", 120, 36.8],
    ["VALE3", "Vale ON", 75, 61.2],
    ["ITUB4", "Itaú Unibanco PN", 100, 29.5]
  ] as const;

  for (const [symbol, name, quantity, avgPrice] of positions) {
    await pool.query(
      `INSERT INTO positions (id, user_id, symbol, name, quantity, avg_price, currency)
       VALUES ($1, $2, $3, $4, $5, $6, 'BRL')
       ON CONFLICT (user_id, symbol)
       DO UPDATE SET
         name = EXCLUDED.name,
         quantity = EXCLUDED.quantity,
         avg_price = EXCLUDED.avg_price`,
      [createId(), userId, symbol, name, quantity, avgPrice]
    );
  }

  const watchlist = ["PETR4", "VALE3", "ITSA4", "WEGE3"];
  for (const symbol of watchlist) {
    await pool.query(
      `INSERT INTO watchlist (id, user_id, symbol, thesis, risk_level)
       VALUES ($1, $2, $3, 'Monitorar tendencia e valuation relativo', 'moderado')
       ON CONFLICT (user_id, symbol)
       DO NOTHING`,
      [createId(), userId, symbol]
    );
  }

  console.log("Seed concluido com sucesso.");
  console.log("Usuario demo:");
  console.log(`Email: ${email}`);
  console.log(`Senha: ${password}`);
}

main()
  .catch((error) => {
    console.error("Erro no seed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
