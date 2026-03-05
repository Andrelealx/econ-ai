import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { getMonthRef, monthRange } from "../utils/date";
import { createId } from "../utils/id";
import { buildOpportunities } from "../services/opportunityEngine";
import { generateAdvisorReply } from "../services/advisorService";
import { AccountSnapshot, GoalSnapshot, tryExecuteAdvisorAction } from "../services/advisorActions";

type AdvisorContext = {
  monthRef: string;
  income: number;
  expenses: number;
  savingsRate: number;
  topExpenseCategories: Array<{ category: string; total: number }>;
  budgetsOverLimit: Array<{ category: string; spent: number; limit: number }>;
  goals: Array<{ name: string; targetAmount: number; currentAmount: number; status: string }>;
  opportunities: Array<{ symbol: string; score: number; signal: string; risk: string }>;
};

type AdvisorSnapshot = {
  context: AdvisorContext;
  goals: GoalSnapshot[];
  accounts: AccountSnapshot[];
};

const messageSchema = z.object({
  message: z.string().min(4).max(2000)
});

export const advisorRouter = Router();

async function loadAdvisorSnapshot(userId: string, monthRef: string): Promise<AdvisorSnapshot> {
  const { start, end } = monthRange(monthRef);

  const [totalsResult, categoriesResult, budgetResult, goalsResult, watchlistResult, accountsResult] = await Promise.all([
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
    pool.query<{ id: string; name: string; target_amount: string; current_amount: string; status: string }>(
      `SELECT id, name, target_amount, current_amount, status
       FROM goals
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    ),
    pool.query<{ symbol: string }>(
      `SELECT symbol FROM watchlist WHERE user_id = $1 ORDER BY created_at DESC LIMIT 6`,
      [userId]
    ),
    pool.query<{ id: string; name: string; type: string; currency: string }>(
      `SELECT id, name, type, currency
       FROM accounts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
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

  const goals: GoalSnapshot[] = goalsResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    targetAmount: Number(row.target_amount),
    currentAmount: Number(row.current_amount),
    status: row.status as GoalSnapshot["status"]
  }));

  const accounts: AccountSnapshot[] = accountsResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as AccountSnapshot["type"],
    currency: row.currency
  }));

  const symbols = watchlistResult.rows.map((row) => row.symbol);
  const opportunities = symbols.length ? await buildOpportunities(symbols) : [];

  const context: AdvisorContext = {
    monthRef,
    income,
    expenses,
    savingsRate,
    topExpenseCategories: categoriesResult.rows.map((row) => ({
      category: row.category,
      total: Number(row.total)
    })),
    budgetsOverLimit,
    goals: goals.slice(0, 5).map((goal) => ({
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      status: goal.status
    })),
    opportunities: opportunities.slice(0, 5).map((row) => ({
      symbol: row.symbol,
      score: row.score,
      signal: row.signal,
      risk: row.risk
    }))
  };

  return { context, goals, accounts };
}

advisorRouter.post("/advisor/chat", async (req, res) => {
  const userId = req.userId as string;
  const parsed = messageSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Mensagem invalida", details: parsed.error.flatten() });
    return;
  }

  const monthRef = getMonthRef();
  const userMessage = parsed.data.message.trim();

  let snapshot = await loadAdvisorSnapshot(userId, monthRef);

  const actionResolution = await tryExecuteAdvisorAction({
    userId,
    message: userMessage,
    goals: snapshot.goals,
    accounts: snapshot.accounts,
    monthRef
  });

  if (actionResolution.action) {
    snapshot = await loadAdvisorSnapshot(userId, monthRef);
  }

  const context = snapshot.context;

  const reply = actionResolution.handled
    ? actionResolution.message ?? "## Acao processada\nRecebi seu comando e finalizei a solicitacao com sucesso."
    : await generateAdvisorReply(userMessage, context);

  await pool.query(
    `INSERT INTO ai_messages (id, user_id, role, content)
     VALUES ($1, $2, 'user', $3),
            ($4, $2, 'assistant', $5)`,
    [createId(), userId, userMessage, createId(), reply]
  );

  res.json({
    data: {
      message: reply,
      context,
      action: actionResolution.action ?? null
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

