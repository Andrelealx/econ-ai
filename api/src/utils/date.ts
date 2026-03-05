export function getMonthRef(input?: string): string {
  if (input && /^\d{4}-\d{2}$/.test(input)) {
    return input;
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function monthRange(monthRef: string): { start: string; end: string } {
  const [yearRaw, monthRaw] = monthRef.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));

  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}
