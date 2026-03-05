import { Router } from "express";
import { pool } from "../db/pool";
import { getMonthRef, monthRange } from "../utils/date";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard/summary", async (req, res) => {
  const userId = req.userId as string;
  const monthRef = getMonthRef(typeof req.query.month === "string" ? req.query.month : undefined);
  const { start, end } = monthRange(monthRef);

  const [totalsResult, categoriesResult, budgetsResult, goalsResult, cashResult, investedCostResult] = await Promise.all([
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
       LIMIT 6`,
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
       GROUP BY b.category, b.monthly_limit
       ORDER BY b.category ASC`,
      [userId, start, end, monthRef]
    ),
    pool.query<{ id: string; name: string; target_amount: string; current_amount: string; status: string }>(
      `SELECT id, name, target_amount, current_amount, status
       FROM goals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [userId]
    ),
    pool.query<{ total_cash: string }>(
      `SELECT COALESCE(SUM(balance), 0) AS total_cash
       FROM accounts
       WHERE user_id = $1`,
      [userId]
    ),
    pool.query<{ total_invested: string }>(
      `SELECT COALESCE(SUM(quantity * avg_price), 0) AS total_invested
       FROM positions
       WHERE user_id = $1`,
      [userId]
    )
  ]);

  const income = Number(totalsResult.rows[0]?.income ?? 0);
  const expense = Number(totalsResult.rows[0]?.expense ?? 0);
  const savings = income - expense;
  const savingsRate = income > 0 ? (savings / income) * 100 : 0;

  const categories = categoriesResult.rows.map((row) => ({
    category: row.category,
    total: Number(row.total)
  }));

  const budgets = budgetsResult.rows.map((row) => {
    const spent = Number(row.spent);
    const monthlyLimit = Number(row.monthly_limit);

    return {
      category: row.category,
      spent,
      monthlyLimit,
      percentUsed: monthlyLimit > 0 ? Number(((spent / monthlyLimit) * 100).toFixed(1)) : 0,
      isOverLimit: spent > monthlyLimit
    };
  });

  const goals = goalsResult.rows.map((row) => {
    const target = Number(row.target_amount);
    const current = Number(row.current_amount);

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      targetAmount: target,
      currentAmount: current,
      progressPercent: target > 0 ? Number(((current / target) * 100).toFixed(1)) : 0
    };
  });

  const totalCash = Number(cashResult.rows[0]?.total_cash ?? 0);
  const totalInvested = Number(investedCostResult.rows[0]?.total_invested ?? 0);

  res.json({
    data: {
      monthRef,
      totals: {
        income,
        expense,
        savings,
        savingsRate: Number(savingsRate.toFixed(1))
      },
      patrimony: {
        totalCash,
        totalInvested,
        estimatedNetWorth: Number((totalCash + totalInvested).toFixed(2))
      },
      categories,
      budgets,
      goals
    }
  });
});
