import { mean, stddev, seasonalityByDow } from "./stats";
import type { DailyOut } from "./consumption";

export const DEFAULT_LEAD_TIME_DAYS = 3;
export const DEFAULT_SAFETY_DAYS = 2;

export type DepletionForecast = {
  avg_daily: number;
  stddev_daily: number;
  days_remaining: number | null;
  depletion_date: string | null;
  ci_low_days: number | null;
  ci_high_days: number | null;
  risk: "baixo" | "medio" | "alto" | "sem_consumo";
};

export function depletionForecast(
  currentStock: number,
  daily: DailyOut[],
  leadTimeDays = DEFAULT_LEAD_TIME_DAYS,
): DepletionForecast {
  const qty = daily.map((d) => d.qty);
  const avg = mean(qty);
  const sd = stddev(qty);

  if (avg <= 0 || currentStock <= 0) {
    return {
      avg_daily: avg,
      stddev_daily: sd,
      days_remaining: currentStock <= 0 ? 0 : null,
      depletion_date: currentStock <= 0 ? new Date().toISOString().slice(0, 10) : null,
      ci_low_days: null,
      ci_high_days: null,
      risk: currentStock <= 0 ? "alto" : "sem_consumo",
    };
  }

  const daysRemaining = currentStock / avg;
  // 95% CI on days: use avg ± 1.96*sd (bounded)
  const lowAvg = Math.max(avg - 1.96 * sd, avg * 0.5);
  const highAvg = avg + 1.96 * sd;
  const ciHigh = currentStock / lowAvg;
  const ciLow = currentStock / highAvg;

  const depletionAt = new Date();
  depletionAt.setUTCDate(depletionAt.getUTCDate() + Math.floor(daysRemaining));

  let risk: DepletionForecast["risk"] = "baixo";
  if (daysRemaining <= leadTimeDays) risk = "alto";
  else if (daysRemaining <= leadTimeDays * 2) risk = "medio";

  return {
    avg_daily: avg,
    stddev_daily: sd,
    days_remaining: Number(daysRemaining.toFixed(2)),
    depletion_date: depletionAt.toISOString().slice(0, 10),
    ci_low_days: Number(ciLow.toFixed(2)),
    ci_high_days: Number(ciHigh.toFixed(2)),
    risk,
  };
}

export function suggestPurchaseQty(
  currentStock: number,
  minStock: number,
  daily: DailyOut[],
  horizonDays: number,
  safetyDays = DEFAULT_SAFETY_DAYS,
): {
  avg_daily: number;
  forecast_consumption: number;
  safety_stock: number;
  target_stock: number;
  suggested_qty: number;
} {
  const qty = daily.map((d) => d.qty);
  const avg = mean(qty);
  const seasonal = seasonalityByDow(daily);

  // If we have per-DOW averages, sum expected qty for the next `horizonDays` starting today
  let forecast = 0;
  if (seasonal.some((v) => v > 0)) {
    const start = new Date();
    for (let i = 0; i < horizonDays; i++) {
      const dow = (start.getUTCDay() + i) % 7;
      const v = seasonal[dow];
      forecast += Number.isFinite(v) && v > 0 ? v : avg;
    }
  } else {
    forecast = avg * horizonDays;
  }

  const safety = Math.max(avg * safetyDays, minStock);
  const target = forecast + safety;
  const suggested = Math.max(target - currentStock, 0);

  return {
    avg_daily: Number(avg.toFixed(3)),
    forecast_consumption: Number(forecast.toFixed(3)),
    safety_stock: Number(safety.toFixed(3)),
    target_stock: Number(target.toFixed(3)),
    suggested_qty: Number(suggested.toFixed(3)),
  };
}
