import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { pool } from "../db/pool";
import { monthRange, getMonthRef } from "../utils/date";
import { createId } from "../utils/id";

const upload = multer({ storage: multer.memoryStorage() });

const accountSchema = z.object({
  name: z.string().min(2).max(80),
  type: z.enum(["checking", "savings", "wallet", "brokerage"]),
  currency: z.string().min(3).max(8).default("BRL"),
  balance: z.coerce.number().default(0)
});

const transactionSchema = z.object({
  accountId: z.string().optional(),
  type: z.enum(["income", "expense", "transfer"]),
  category: z.string().min(2).max(80),
  description: z.string().min(2).max(180),
  amount: z.coerce.number().positive(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const budgetSchema = z.object({
  category: z.string().min(2).max(80),
  monthRef: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  monthlyLimit: z.coerce.number().positive()
});

const goalSchema = z.object({
  name: z.string().min(2).max(120),
  targetAmount: z.coerce.number().positive(),
  currentAmount: z.coerce.number().min(0).default(0),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["active", "completed", "paused"]).default("active")
});

const goalProgressSchema = z.object({
  currentAmount: z.coerce.number().min(0),
  status: z.enum(["active", "completed", "paused"]).optional()
});

export const financeRouter = Router();

async function adjustAccountBalance(userId: string, accountId: string | undefined, type: string, amount: number): Promise<void> {
  if (!accountId) {
    return;
  }

  let delta = 0;
  if (type === "income") {
    delta = amount;
  } else if (type === "expense") {
    delta = -amount;
  }

  if (delta === 0) {
    return;
  }

  await pool.query(
    `UPDATE accounts
     SET balance = balance + $1
     WHERE id = $2 AND user_id = $3`,
    [delta, accountId, userId]
  );
}

financeRouter.get("/finance/accounts", async (req, res) => {
  const userId = req.userId as string;

  const result = await pool.query<{
    id: string;
    name: string;
    type: string;
    currency: string;
    balance: string;
    created_at: string;
  }>(
    `SELECT id, name, type, currency, balance, created_at
     FROM accounts
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );

  res.json({
    data: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      balance: Number(row.balance),
      createdAt: row.created_at
    }))
  });
});

financeRouter.post("/finance/accounts", async (req, res) => {
  const userId = req.userId as string;
  const parsed = accountSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const accountId = createId();
  const payload = parsed.data;

  await pool.query(
    `INSERT INTO accounts (id, user_id, name, type, currency, balance)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [accountId, userId, payload.name.trim(), payload.type, payload.currency.toUpperCase(), payload.balance]
  );

  res.status(201).json({
    data: {
      id: accountId,
      ...payload,
      currency: payload.currency.toUpperCase()
    }
  });
});

financeRouter.get("/finance/transactions", async (req, res) => {
  const userId = req.userId as string;
  const monthRef = getMonthRef(typeof req.query.month === "string" ? req.query.month : undefined);
  const { start, end } = monthRange(monthRef);

  const result = await pool.query<{
    id: string;
    account_id: string | null;
    account_name: string | null;
    type: string;
    category: string;
    description: string;
    amount: string;
    occurred_on: string;
    created_at: string;
  }>(
    `SELECT t.id,
            t.account_id,
            a.name AS account_name,
            t.type,
            t.category,
            t.description,
            t.amount,
            t.occurred_on,
            t.created_at
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.user_id = $1
       AND t.occurred_on >= $2::date
       AND t.occurred_on < $3::date
     ORDER BY t.occurred_on DESC, t.created_at DESC`,
    [userId, start, end]
  );

  res.json({
    data: result.rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      accountName: row.account_name,
      type: row.type,
      category: row.category,
      description: row.description,
      amount: Number(row.amount),
      occurredOn: row.occurred_on,
      createdAt: row.created_at
    })),
    meta: { monthRef }
  });
});

financeRouter.post("/finance/transactions", async (req, res) => {
  const userId = req.userId as string;
  const parsed = transactionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const payload = parsed.data;
  const transactionId = createId();

  await pool.query(
    `INSERT INTO transactions (id, user_id, account_id, type, category, description, amount, occurred_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      transactionId,
      userId,
      payload.accountId ?? null,
      payload.type,
      payload.category.trim(),
      payload.description.trim(),
      payload.amount,
      payload.occurredOn
    ]
  );

  await adjustAccountBalance(userId, payload.accountId, payload.type, payload.amount);

  res.status(201).json({
    data: {
      id: transactionId,
      ...payload
    }
  });
});

financeRouter.post("/finance/transactions/import-csv", upload.single("file"), async (req, res) => {
  const userId = req.userId as string;
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: "Arquivo CSV nao enviado" });
    return;
  }

  const content = file.buffer.toString("utf8");
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Array<Record<string, string>>;

  const errors: Array<{ line: number; reason: string }> = [];
  let imported = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    const parsed = transactionSchema.safeParse({
      accountId: row.accountId || row.account_id || undefined,
      type: row.type,
      category: row.category,
      description: row.description,
      amount: row.amount,
      occurredOn: row.occurredOn || row.occurred_on
    });

    if (!parsed.success) {
      errors.push({
        line: index + 2,
        reason: "Formato invalido"
      });
      continue;
    }

    const payload = parsed.data;

    await pool.query(
      `INSERT INTO transactions (id, user_id, account_id, type, category, description, amount, occurred_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        createId(),
        userId,
        payload.accountId ?? null,
        payload.type,
        payload.category,
        payload.description,
        payload.amount,
        payload.occurredOn
      ]
    );

    await adjustAccountBalance(userId, payload.accountId, payload.type, payload.amount);
    imported += 1;
  }

  res.json({
    data: {
      imported,
      totalRows: rows.length,
      errors
    }
  });
});

financeRouter.get("/finance/budgets", async (req, res) => {
  const userId = req.userId as string;
  const monthRef = getMonthRef(typeof req.query.month === "string" ? req.query.month : undefined);

  const result = await pool.query<{
    id: string;
    category: string;
    month_ref: string;
    monthly_limit: string;
  }>(
    `SELECT id, category, month_ref, monthly_limit
     FROM budgets
     WHERE user_id = $1
       AND month_ref = $2
     ORDER BY category ASC`,
    [userId, monthRef]
  );

  res.json({
    data: result.rows.map((row) => ({
      id: row.id,
      category: row.category,
      monthRef: row.month_ref,
      monthlyLimit: Number(row.monthly_limit)
    }))
  });
});

financeRouter.put("/finance/budgets", async (req, res) => {
  const userId = req.userId as string;
  const parsed = budgetSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const payload = parsed.data;
  const monthRef = getMonthRef(payload.monthRef);
  const budgetId = createId();

  await pool.query(
    `INSERT INTO budgets (id, user_id, category, month_ref, monthly_limit)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, category, month_ref)
     DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit`,
    [budgetId, userId, payload.category.trim(), monthRef, payload.monthlyLimit]
  );

  res.json({
    data: {
      category: payload.category.trim(),
      monthRef,
      monthlyLimit: payload.monthlyLimit
    }
  });
});

financeRouter.get("/finance/goals", async (req, res) => {
  const userId = req.userId as string;

  const result = await pool.query<{
    id: string;
    name: string;
    target_amount: string;
    current_amount: string;
    target_date: string | null;
    status: string;
    created_at: string;
  }>(
    `SELECT id, name, target_amount, current_amount, target_date, status, created_at
     FROM goals
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  res.json({
    data: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      targetAmount: Number(row.target_amount),
      currentAmount: Number(row.current_amount),
      targetDate: row.target_date,
      status: row.status,
      createdAt: row.created_at,
      progressPercent:
        Number(row.target_amount) > 0
          ? Number(((Number(row.current_amount) / Number(row.target_amount)) * 100).toFixed(1))
          : 0
    }))
  });
});

financeRouter.post("/finance/goals", async (req, res) => {
  const userId = req.userId as string;
  const parsed = goalSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const payload = parsed.data;
  const goalId = createId();

  await pool.query(
    `INSERT INTO goals (id, user_id, name, target_amount, current_amount, target_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      goalId,
      userId,
      payload.name.trim(),
      payload.targetAmount,
      payload.currentAmount,
      payload.targetDate ?? null,
      payload.status
    ]
  );

  res.status(201).json({
    data: {
      id: goalId,
      ...payload
    }
  });
});

financeRouter.patch("/finance/goals/:id", async (req, res) => {
  const userId = req.userId as string;
  const goalId = req.params.id;
  const parsed = goalProgressSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const payload = parsed.data;

  const update = await pool.query(
    `UPDATE goals
     SET current_amount = $1,
         status = COALESCE($2, status)
     WHERE id = $3
       AND user_id = $4`,
    [payload.currentAmount, payload.status ?? null, goalId, userId]
  );

  if (!update.rowCount) {
    res.status(404).json({ error: "Meta nao encontrada" });
    return;
  }

  res.json({ data: { id: goalId, ...payload } });
});
