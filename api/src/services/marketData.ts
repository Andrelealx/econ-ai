import { env } from "../config";

export type MarketQuote = {
  symbol: string;
  price: number;
  changePercent: number | null;
  previousClose: number | null;
  currency: string;
  marketTime: string | null;
  source: "brapi" | "stooq";
};

export type MarketCandle = {
  date: string;
  close: number;
};

type BrapiResponse = {
  error?: boolean;
  message?: string;
  results?: Array<{
    symbol?: string;
    currency?: string;
    regularMarketPrice?: number;
    regularMarketPreviousClose?: number;
    regularMarketChangePercent?: number;
    regularMarketTime?: string;
    historicalDataPrice?: Array<{
      date: number;
      close: number;
    }>;
  }>;
};

function isBrazilianSymbol(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return normalized.endsWith(".SA") || /^[A-Z]{4}\d{1,2}$/.test(normalized);
}

function normalizeBrapiSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.SA$/, "");
}

function normalizeStooqSymbol(symbol: string): string {
  const raw = symbol.trim().toLowerCase();
  if (raw.includes(".")) {
    return raw;
  }
  if (/^[a-z]{1,5}$/.test(raw)) {
    return `${raw}.us`;
  }
  return raw;
}

function parseCsvRows(csv: string): string[][] {
  return csv
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

async function fetchBrapi(symbol: string): Promise<{ quote: MarketQuote | null; candles: MarketCandle[] }> {
  const normalized = normalizeBrapiSymbol(symbol);
  const params = new URLSearchParams({ range: "3mo", interval: "1d" });

  if (env.BRAPI_TOKEN) {
    params.set("token", env.BRAPI_TOKEN);
  }

  const response = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(normalized)}?${params.toString()}`);

  if (!response.ok) {
    return { quote: null, candles: [] };
  }

  const payload = (await response.json()) as BrapiResponse;
  if (payload.error || !payload.results?.length) {
    return { quote: null, candles: [] };
  }

  const result = payload.results[0];
  const price = Number(result.regularMarketPrice ?? 0);

  if (!price || Number.isNaN(price)) {
    return { quote: null, candles: [] };
  }

  const candles = (result.historicalDataPrice ?? [])
    .map((row) => ({
      date: new Date(row.date * 1000).toISOString().slice(0, 10),
      close: Number(row.close)
    }))
    .filter((row) => !Number.isNaN(row.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    quote: {
      symbol: (result.symbol ?? normalized).toUpperCase(),
      price,
      changePercent: Number.isFinite(Number(result.regularMarketChangePercent))
        ? Number(result.regularMarketChangePercent)
        : null,
      previousClose: Number.isFinite(Number(result.regularMarketPreviousClose))
        ? Number(result.regularMarketPreviousClose)
        : null,
      currency: (result.currency ?? "BRL").toUpperCase(),
      marketTime: result.regularMarketTime ?? null,
      source: "brapi"
    },
    candles
  };
}

async function fetchStooqQuote(symbol: string): Promise<MarketQuote | null> {
  const normalized = normalizeStooqSymbol(symbol);
  const response = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(normalized)}&i=d`);

  if (!response.ok) {
    return null;
  }

  const csv = await response.text();
  const rows = parseCsvRows(csv);
  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  if (row.length < 8) {
    return null;
  }

  const [symbolRaw, dateRaw, timeRaw, openRaw, highRaw, lowRaw, closeRaw] = row;

  if (closeRaw === "N/D") {
    return null;
  }

  const close = Number(closeRaw);
  const open = Number(openRaw);
  if (Number.isNaN(close)) {
    return null;
  }

  let changePercent: number | null = null;
  let previousClose: number | null = null;

  if (Number.isFinite(open) && open > 0) {
    changePercent = ((close - open) / open) * 100;
    previousClose = open;
  }

  return {
    symbol: symbolRaw.toUpperCase(),
    price: close,
    changePercent,
    previousClose,
    currency: "USD",
    marketTime: dateRaw && timeRaw ? `${dateRaw}T${timeRaw}Z` : null,
    source: "stooq"
  };
}

async function fetchStooqCandles(symbol: string, limit = 120): Promise<MarketCandle[]> {
  const normalized = normalizeStooqSymbol(symbol);
  const response = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(normalized)}&i=d`);

  if (!response.ok) {
    return [];
  }

  const csv = await response.text();
  const rows = parseCsvRows(csv);
  if (rows.length <= 1) {
    return [];
  }

  const candles = rows
    .slice(1)
    .map((row) => ({
      date: row[0],
      close: Number(row[4])
    }))
    .filter((row) => row.date && !Number.isNaN(row.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  return candles.slice(-limit);
}

export async function getQuote(symbol: string): Promise<MarketQuote | null> {
  if (isBrazilianSymbol(symbol)) {
    const brapiData = await fetchBrapi(symbol);
    if (brapiData.quote) {
      return brapiData.quote;
    }
  }

  return fetchStooqQuote(symbol);
}

export async function getCandles(symbol: string, limit = 120): Promise<MarketCandle[]> {
  if (isBrazilianSymbol(symbol)) {
    const brapiData = await fetchBrapi(symbol);
    if (brapiData.candles.length) {
      return brapiData.candles.slice(-limit);
    }
  }

  return fetchStooqCandles(symbol, limit);
}
