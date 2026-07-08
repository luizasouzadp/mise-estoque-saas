export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

// Group daily consumption by day-of-week (0=Sun..6=Sat), returns average per DOW.
export function seasonalityByDow(daily: { date: string; qty: number }[]): number[] {
  const buckets: number[][] = Array.from({ length: 7 }, () => []);
  for (const d of daily) {
    const dow = new Date(d.date + "T12:00:00Z").getUTCDay();
    buckets[dow].push(d.qty);
  }
  return buckets.map(mean);
}
