import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { getMonthRef, monthRange } from "../utils/date";
import { createId } from "../utils/id";
import { buildOpportunities } from "../services/opportunityEngine";
import { generateAdvisorReply } from "../services/advisorService";

const messageSchema = z.object({
  message: z.string().min(4).max(2000)
});

export const advisorRouter = Router();

advisorRouter.post("/advisor/chat", async (req, res) => {
  const userId = req.userId as string;
  const parsed = messageSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Mensagem invalida", details: parsed.error.flatten() });
    return;
  }

  const monthRef = getMonthRef();
  const { start, end } = monthRange(monthRef);

  const [totalsResult, categoriesResult, budgetResult, goalsResult, watchlistResult] = await Promise.all([
    pool.query<{ income: string; expense: string }>(
      `SELECT
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = $1
         AND occurred_on >= $2::date
         AND occurred_on < $3::date`,
      [userId, start, end]
    ),
    pool.query<{ category: string; total: string }>(
      `SELECT category, COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE user_id = $1
         AND type = 'expense'
         AND occurred_on >= $2::date
         AND occurred_on < $3::date
       GROUP BY category
       ORDER BY total DESC
       LIMIT 5`,
      [userId, start, end]
    ),
    pool.query<{ category: string; monthly_limit: string; spent: string }>(
      `SELECT b.category,
              b.monthly_limit,
              COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS spent
       FROM budgets b
       LEFT JOIN transactions t
         ON t.user_id = b.user_id
        AND t.category = b.category
        AND t.occurred_on >= $2::date
        AND t.occurred_on < $3::date
       WHERE b.user_id = $1
         AND b.month_ref = $4
       GROUP BY b.category, b.monthly_limit`,
      [userId, start, end, monthRef]
    ),
    pool.query<{ name: string; target_amount: string; current_amount: string; status: string }>(
      `SELECT name, target_amount, current_amount, status
       FROM goals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [userId]
    ),
    pool.query<{ symbol: string }>(
      `SELECT symbol FROM watchlist WHERE user_id = $1 ORDER BY created_at DESC LIMIT 6`,
      [userId]
    )
  ]);

  const income = Number(totalsResult.rows[0]?.income ?? 0);
  const expenses = Number(totalsResult.rows[0]?.expense ?? 0);
  const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0;

  const budgetsOverLimit = budgetResult.rows
    .map((row) => ({
      category: row.category,
      limit: Number(row.monthly_limit),
      spent: Number(row.spent)
    }))
    .filter((row) => row.spent > row.limit)
    .sort((a, b) => b.spent - b.limit - (a.spent - a.limit));

  const symbols = watchlistResult.rows.map((row) => row.symbol);
  const opportunities = symbols.length ? await buildOpportunities(symbols) : [];

  const context = {
    monthRef,
    income,
    expenses,
    savingsRate,
    topExpenseCategories: categoriesResult.rows.map((row) => ({
      category: row.category,
      total: Number(row.total)
    })),
    budgetsOverLimit,
    goals: goalsResult.rows.map((row) => ({
      name: row.name,
      targetAmount: Number(row.target_amount),
      currentAmount: Number(row.current_amount),
      status: row.status
    })),
    opportunities: opportunities.slice(0, 5).map((row) => ({
      symbol: row.symbol,
      score: row.score,
      signal: row.signal,
      risk: row.risk
    }))
  };

  const userMessage = parsed.data.message.trim();
  const reply = await generateAdvisorReply(userMessage, context);

  await pool.query(
    `INSERT INTO ai_messages (id, user_id, role, content)
     VALUES ($1, $2, 'user', $3),
            ($4, $2, 'assistant', $5)`,
    [createId(), userId, userMessage, createId(), reply]
  );

  res.json({
    data: {
      message: reply,
      context
    }
  });
});

advisorRouter.get("/advisor/history", async (req, res) => {
  const userId = req.userId as string;
  const limit = Math.min(Number(req.query.limit ?? 30), 100);

  const result = await pool.query<{
    id: string;
    role: string;
    content: string;
    created_at: string;
  }>(
    `SELECT id, role, content, created_at
     FROM ai_messages
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  res.json({
    data: result.rows
      .reverse()
      .map((row) => ({ id: row.id, role: row.role, content: row.content, createdAt: row.created_at }))
  });
});
