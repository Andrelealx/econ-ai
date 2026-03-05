export function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
