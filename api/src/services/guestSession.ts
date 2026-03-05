import bcrypt from "bcryptjs";
import { pool } from "../db/pool";
import { createId } from "../utils/id";

export type GuestSessionUser = {
  id: string;
  fullName: string;
  email: string;
  monthlyIncome: number;
  riskProfile: "conservador" | "moderado" | "arrojado";
};

function getMonthRef(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function createGuestSessionUser(): Promise<GuestSessionUser> {
  const userId = createId();
  const email = `guest.${userId.slice(0, 8)}@econ-ai.local`;
  const fullName = "Convidado econ-ai";
  const monthlyIncome = 8500;
  const riskProfile: GuestSessionUser["riskProfile"] = "moderado";

  const passwordHash = await bcrypt.hash(createId(), 8);

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, monthly_income, risk_profile)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, fullName, email, passwordHash, monthlyIncome, riskProfile]
  );

  const checkingId = createId();

  await pool.query(
    `INSERT INTO accounts (id, user_id, name, type, currency, balance)
     VALUES
      ($1, $3, 'Conta principal', 'checking', 'BRL', 4200),
      ($2, $3, 'Corretora', 'brokerage', 'BRL', 12000)`,
    [checkingId, createId(), userId]
  );

  const monthRef = getMonthRef();

  const sampleTransactions: Array<{
    type: "income" | "expense";
    category: string;
    description: string;
    amount: number;
    occurredOn: string;
  }> = [
    {
      type: "income",
      category: "salario",
      description: "Salario",
      amount: 8500,
      occurredOn: `${monthRef}-05`
    },
    {
      type: "expense",
      category: "moradia",
      description: "Aluguel",
      amount: 2200,
      occurredOn: `${monthRef}-06`
    },
    {
      type: "expense",
      category: "alimentacao",
      description: "Supermercado",
      amount: 980,
      occurredOn: `${monthRef}-07`
    },
    {
      type: "expense",
      category: "transporte",
      description: "Combustivel",
      amount: 430,
      occurredOn: `${monthRef}-08`
    },
    {
      type: "expense",
      category: "lazer",
      description: "Restaurantes e apps",
      amount: 520,
      occurredOn: `${monthRef}-09`
    }
  ];

  for (const item of sampleTransactions) {
    await pool.query(
      `INSERT INTO transactions (id, user_id, account_id, type, category, description, amount, occurred_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)`,
      [createId(), userId, checkingId, item.type, item.category, item.description, item.amount, item.occurredOn]
    );
  }

  const budgets = [
    ["moradia", 2300],
    ["alimentacao", 900],
    ["transporte", 500],
    ["lazer", 450]
  ] as const;

  for (const [category, monthlyLimit] of budgets) {
    await pool.query(
      `INSERT INTO budgets (id, user_id, category, month_ref, monthly_limit)
       VALUES ($1, $2, $3, $4, $5)`,
      [createId(), userId, category, monthRef, monthlyLimit]
    );
  }

  await pool.query(
    `INSERT INTO goals (id, user_id, name, target_amount, current_amount, target_date, status)
     VALUES
       ($1, $4, 'Reserva de emergencia', 20000, 5200, NOW() + INTERVAL '10 months', 'active'),
       ($2, $4, 'Viagem internacional', 12000, 2800, NOW() + INTERVAL '9 months', 'active'),
       ($3, $4, 'Curso de especializacao', 6000, 1500, NOW() + INTERVAL '7 months', 'active')`,
    [createId(), createId(), createId(), userId]
  );

  const positions = [
    ["PETR4", "Petrobras PN", 100, 37.4],
    ["VALE3", "Vale ON", 45, 62.5],
    ["ITUB4", "Itau PN", 80, 30.8]
  ] as const;

  for (const [symbol, name, quantity, avgPrice] of positions) {
    await pool.query(
      `INSERT INTO positions (id, user_id, symbol, name, quantity, avg_price, currency)
       VALUES ($1, $2, $3, $4, $5, $6, 'BRL')`,
      [createId(), userId, symbol, name, quantity, avgPrice]
    );
  }

  const watchlist = ["PETR4", "VALE3", "WEGE3", "ITSA4"];

  for (const symbol of watchlist) {
    await pool.query(
      `INSERT INTO watchlist (id, user_id, symbol, thesis, risk_level)
       VALUES ($1, $2, $3, 'Ativo em observacao para entrada por tendencia', 'moderado')`,
      [createId(), userId, symbol]
    );
  }

  return {
    id: userId,
    fullName,
    email,
    monthlyIncome,
    riskProfile
  };
}
