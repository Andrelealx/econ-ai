import { getCandles, getQuote, type MarketQuote } from "./marketData";

type OpportunitySignal = "potencial_alta" | "monitorar" | "cautela";

export type OpportunityInsight = {
  symbol: string;
  signal: OpportunitySignal;
  score: number;
  risk: "baixo" | "medio" | "alto";
  reasons: string[];
  metrics: {
    price: number;
    sma20: number;
    sma50: number;
    momentum30d: number;
    volatilityAnnualized: number;
  };
  quote: MarketQuote;
};

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getRiskFromVolatility(volatility: number): "baixo" | "medio" | "alto" {
  if (volatility < 22) {
    return "baixo";
  }
  if (volatility < 40) {
    return "medio";
  }
  return "alto";
}

export async function buildOpportunity(symbol: string): Promise<OpportunityInsight | null> {
  const [quote, candles] = await Promise.all([getQuote(symbol), getCandles(symbol, 120)]);

  if (!quote || candles.length < 25) {
    return null;
  }

  const closes = candles.map((item) => item.close);
  const currentPrice = quote.price;
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));

  const close30 = closes.at(-31) ?? closes[0];
  const momentum30d = close30 > 0 ? ((currentPrice - close30) / close30) * 100 : 0;

  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const prev = closes[index - 1];
    const next = closes[index];
    if (prev > 0) {
      returns.push((next - prev) / prev);
    }
  }

  const volatilityAnnualized = standardDeviation(returns) * Math.sqrt(252) * 100;

  const reasons: string[] = [];
  let score = 50;

  if (currentPrice > sma20) {
    score += 12;
    reasons.push("Preco acima da media de 20 dias");
  } else {
    score -= 10;
    reasons.push("Preco abaixo da media de 20 dias");
  }

  if (sma20 > sma50) {
    score += 15;
    reasons.push("Tendencia de curto prazo acima da media de 50 dias");
  } else {
    score -= 15;
    reasons.push("Tendencia de curto prazo fragilizada");
  }

  if (momentum30d >= 8) {
    score += 15;
    reasons.push("Momentum de 30 dias forte");
  } else if (momentum30d >= 2) {
    score += 7;
    reasons.push("Momentum de 30 dias positivo");
  } else if (momentum30d <= -8) {
    score -= 15;
    reasons.push("Momentum de 30 dias negativo");
  }

  if (volatilityAnnualized <= 25) {
    score += 8;
    reasons.push("Volatilidade controlada");
  } else if (volatilityAnnualized >= 45) {
    score -= 10;
    reasons.push("Volatilidade elevada");
  }

  score = clamp(Math.round(score), 0, 100);

  let signal: OpportunitySignal = "monitorar";
  if (score >= 70) {
    signal = "potencial_alta";
  } else if (score < 45) {
    signal = "cautela";
  }

  return {
    symbol: symbol.toUpperCase(),
    signal,
    score,
    risk: getRiskFromVolatility(volatilityAnnualized),
    reasons,
    metrics: {
      price: Number(currentPrice.toFixed(2)),
      sma20: Number(sma20.toFixed(2)),
      sma50: Number(sma50.toFixed(2)),
      momentum30d: Number(momentum30d.toFixed(2)),
      volatilityAnnualized: Number(volatilityAnnualized.toFixed(2))
    },
    quote
  };
}

export async function buildOpportunities(symbols: string[]): Promise<OpportunityInsight[]> {
  const uniqueSymbols = Array.from(new Set(symbols.map((item) => item.trim().toUpperCase()).filter(Boolean)));
  const insights = await Promise.all(uniqueSymbols.map((symbol) => buildOpportunity(symbol)));

  return insights
    .filter((item): item is OpportunityInsight => item !== null)
    .sort((a, b) => b.score - a.score);
}
