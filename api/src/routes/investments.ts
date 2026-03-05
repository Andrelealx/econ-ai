import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { createId } from "../utils/id";
import { getQuote } from "../services/marketData";
import { buildOpportunities } from "../services/opportunityEngine";

const positionSchema = z.object({
  symbol: z.string().min(1).max(16),
  name: z.string().max(120).optional(),
  quantity: z.coerce.number().positive(),
  avgPrice: z.coerce.number().positive(),
  currency: z.string().min(3).max(8).default("BRL")
});

const watchlistSchema = z.object({
  symbol: z.string().min(1).max(16),
  thesis: z.string().max(500).optional(),
  riskLevel: z.enum(["baixo", "moderado", "alto"]).default("moderado")
});

export const investmentsRouter = Router();

investmentsRouter.get("/investments/positions", async (req, res) => {
  const userId = req.userId as string;

  const positionsResult = await pool.query<{
    id: string;
    symbol: string;
    name: string | null;
    quantity: string;
    avg_price: string;
    currency: string;
    created_at: string;
  }>(
    `SELECT id, symbol, name, quantity, avg_price, currency, created_at
     FROM positions
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  const withMarket = await Promise.all(
    positionsResult.rows.map(async (row) => {
      const quote = await getQuote(row.symbol);
      const quantity = Number(row.quantity);
      const avgPrice = Number(row.avg_price);
      const costBasis = quantity * avgPrice;
      const marketPrice = quote?.price ?? avgPrice;
      const marketValue = quantity * marketPrice;
      const unrealizedPnl = marketValue - costBasis;

      return {
        id: row.id,
        symbol: row.symbol,
        name: row.name,
        quantity,
        avgPrice,
        currency: row.currency,
        costBasis: Number(costBasis.toFixed(2)),
        marketPrice: Number(marketPrice.toFixed(2)),
        marketValue: Number(marketValue.toFixed(2)),
        unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
        createdAt: row.created_at,
        quoteSource: quote?.source ?? null
      };
    })
  );

  res.json({ data: withMarket });
});

investmentsRouter.put("/investments/positions", async (req, res) => {
  const userId = req.userId as string;
  const parsed = positionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const payload = parsed.data;
  const symbol = payload.symbol.trim().toUpperCase();

  await pool.query(
    `INSERT INTO positions (id, user_id, symbol, name, quantity, avg_price, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, symbol)
     DO UPDATE SET
       name = EXCLUDED.name,
       quantity = EXCLUDED.quantity,
       avg_price = EXCLUDED.avg_price,
       currency = EXCLUDED.currency`,
    [
      createId(),
      userId,
      symbol,
      payload.name?.trim() || null,
      payload.quantity,
      payload.avgPrice,
      payload.currency.toUpperCase()
    ]
  );

  res.json({
    data: {
      symbol,
      name: payload.name ?? null,
      quantity: payload.quantity,
      avgPrice: payload.avgPrice,
      currency: payload.currency.toUpperCase()
    }
  });
});

investmentsRouter.get("/investments/watchlist", async (req, res) => {
  const userId = req.userId as string;

  const result = await pool.query<{
    id: string;
    symbol: string;
    thesis: string | null;
    risk_level: string;
    created_at: string;
  }>(
    `SELECT id, symbol, thesis, risk_level, created_at
     FROM watchlist
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  res.json({
    data: result.rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      thesis: row.thesis,
      riskLevel: row.risk_level,
      createdAt: row.created_at
    }))
  });
});

investmentsRouter.put("/investments/watchlist", async (req, res) => {
  const userId = req.userId as string;
  const parsed = watchlistSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const payload = parsed.data;
  const symbol = payload.symbol.trim().toUpperCase();

  await pool.query(
    `INSERT INTO watchlist (id, user_id, symbol, thesis, risk_level)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, symbol)
     DO UPDATE SET thesis = EXCLUDED.thesis, risk_level = EXCLUDED.risk_level`,
    [createId(), userId, symbol, payload.thesis?.trim() || null, payload.riskLevel]
  );

  res.json({
    data: {
      symbol,
      thesis: payload.thesis ?? null,
      riskLevel: payload.riskLevel
    }
  });
});

investmentsRouter.delete("/investments/watchlist/:symbol", async (req, res) => {
  const userId = req.userId as string;
  const symbol = req.params.symbol.trim().toUpperCase();

  await pool.query(
    `DELETE FROM watchlist
     WHERE user_id = $1
       AND symbol = $2`,
    [userId, symbol]
  );

  res.status(204).send();
});

investmentsRouter.get("/investments/quote/:symbol", async (req, res) => {
  const symbol = req.params.symbol.trim().toUpperCase();
  const quote = await getQuote(symbol);

  if (!quote) {
    res.status(404).json({ error: "Cotacao nao encontrada para este ativo" });
    return;
  }

  res.json({ data: quote });
});

investmentsRouter.get("/investments/opportunities", async (req, res) => {
  const userId = req.userId as string;

  const symbolsFromQuery = typeof req.query.symbols === "string"
    ? req.query.symbols.split(",").map((item) => item.trim())
    : [];

  let symbols = symbolsFromQuery.filter(Boolean);

  if (!symbols.length) {
    const watchlistResult = await pool.query<{ symbol: string }>(
      `SELECT symbol FROM watchlist WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );

    symbols = watchlistResult.rows.map((row) => row.symbol);
  }

  if (!symbols.length) {
    res.status(400).json({
      error: "Adicione ativos na watchlist ou envie symbols=PETR4,VALE3 para gerar oportunidades"
    });
    return;
  }

  const opportunities = await buildOpportunities(symbols);

  res.json({
    data: opportunities,
    disclaimer:
      "Analise quantitativa educacional. Nao constitui recomendacao individual de investimento."
  });
});
