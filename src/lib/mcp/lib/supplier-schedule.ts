// Pure helpers to compute the next order/delivery date for a supplier
// based on the weekly agenda cadastrada (dias de pedido/entrega; lead time só sem dias de entrega).
// Day convention: 0=domingo … 6=sábado (mesma de Date.getUTCDay()).

export type SupplierSchedule = {
  order_days?: number[] | null;
  delivery_days?: number[] | null;
  lead_time_days?: number | null;
};

function addDaysUTC(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function daysUntilNextDow(from: Date, dows: number[]): number | null {
  if (!dows.length) return null;
  const base = from.getUTCDay();
  let best: number | null = null;
  for (const d of dows) {
    const diff = (d - base + 7) % 7;
    // If today matches, treat as 0 (pode pedir/receber hoje).
    if (best === null || diff < best) best = diff;
  }
  return best;
}

export type ScheduleResult = {
  next_order_date: string | null; // YYYY-MM-DD
  next_delivery_date: string | null;
  next_next_delivery_date: string | null;
  coverage_days: number; // dias que a compra precisa cobrir
};

/**
 * Given today + the supplier schedule, computes:
 * - next_order_date: próximo dia de pedido (inclui hoje).
 * - next_delivery_date: entrega que resulta desse pedido.
 * - next_next_delivery_date: a entrega seguinte (a compra precisa cobrir até lá).
 * - coverage_days: horizonte em dias que a sugestão deve cobrir. Fallback = horizonDefault.
 */
export function computeSchedule(
  today: Date,
  schedule: SupplierSchedule,
  horizonDefault: number,
): ScheduleResult {
  const orderDays = (schedule.order_days ?? []).filter((d) => d >= 0 && d <= 6);
  const deliveryDays = (schedule.delivery_days ?? []).filter((d) => d >= 0 && d <= 6);
  const lead = schedule.lead_time_days ?? null;

  if (!orderDays.length && !deliveryDays.length) {
    return {
      next_order_date: null,
      next_delivery_date: null,
      next_next_delivery_date: null,
      coverage_days: horizonDefault,
    };
  }

  // Próximo dia de pedido (ou hoje se orderDays vazio).
  const daysToOrder = orderDays.length ? (daysUntilNextDow(today, orderDays) ?? 0) : 0;
  const orderDate = addDaysUTC(today, daysToOrder);

  // Entrega de um pedido feito em `order`:
  // - com delivery_days: o PRIMEIRO dia de entrega depois do dia do pedido (lead_time ignorado);
  // - sem delivery_days: pedido + lead_time_days;
  // - sem nenhum dos dois: mesmo dia do pedido.
  const deliveryFor = (order: Date): Date => {
    if (deliveryDays.length) {
      const dayAfter = addDaysUTC(order, 1);
      return addDaysUTC(dayAfter, daysUntilNextDow(dayAfter, deliveryDays) ?? 0);
    }
    if (lead !== null && lead >= 0) return addDaysUTC(order, lead);
    return order;
  };

  const deliveryDate: Date = deliveryFor(orderDate);

  // Próxima entrega DEPOIS dessa: pedido seguinte + entrega.
  let nextNextDelivery: Date | null = null;
  if (orderDays.length) {
    const afterOrder = addDaysUTC(orderDate, 1);
    const nextOrderDate = addDaysUTC(afterOrder, daysUntilNextDow(afterOrder, orderDays) ?? 7);
    nextNextDelivery = deliveryFor(nextOrderDate);
  } else if (deliveryDays.length) {
    const afterDelivery = addDaysUTC(deliveryDate, 1);
    nextNextDelivery = addDaysUTC(afterDelivery, daysUntilNextDow(afterDelivery, deliveryDays) ?? 7);
  }

  const coverageDays = nextNextDelivery
    ? Math.max(
        1,
        Math.ceil((nextNextDelivery.getTime() - today.getTime()) / 86400000),
      )
    : horizonDefault;

  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    next_order_date: iso(orderDate),
    next_delivery_date: iso(deliveryDate),
    next_next_delivery_date: iso(nextNextDelivery),
    coverage_days: coverageDays,
  };
}
