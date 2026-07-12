// Pure helpers to compute the next order/delivery date for a supplier
// based on the weekly agenda cadastrada (dias de pedido/entrega + lead time).
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

  // Entrega: se há lead_time_days, aplica direto; senão, próxima delivery_day após o pedido.
  let deliveryDate: Date | null = null;
  if (lead !== null && lead >= 0) {
    deliveryDate = addDaysUTC(orderDate, lead);
    if (deliveryDays.length) {
      // Ajusta para o próximo delivery_day a partir do resultado.
      const shift = daysUntilNextDow(deliveryDate, deliveryDays) ?? 0;
      deliveryDate = addDaysUTC(deliveryDate, shift);
    }
  } else if (deliveryDays.length) {
    const shift = daysUntilNextDow(addDaysUTC(orderDate, 1), deliveryDays) ?? 0;
    deliveryDate = addDaysUTC(addDaysUTC(orderDate, 1), shift);
  } else {
    // só order_days conhecido: assume entrega no mesmo dia do pedido.
    deliveryDate = orderDate;
  }

  // Próxima entrega DEPOIS dessa: pedido seguinte + delivery.
  let nextNextDelivery: Date | null = null;
  if (orderDays.length) {
    const nextOrderShift = daysUntilNextDow(addDaysUTC(orderDate, 1), orderDays) ?? 7;
    const nextOrderDate = addDaysUTC(addDaysUTC(orderDate, 1), nextOrderShift);
    if (lead !== null && lead >= 0) {
      nextNextDelivery = addDaysUTC(nextOrderDate, lead);
      if (deliveryDays.length) {
        const s = daysUntilNextDow(nextNextDelivery, deliveryDays) ?? 0;
        nextNextDelivery = addDaysUTC(nextNextDelivery, s);
      }
    } else if (deliveryDays.length) {
      const s = daysUntilNextDow(addDaysUTC(nextOrderDate, 1), deliveryDays) ?? 0;
      nextNextDelivery = addDaysUTC(addDaysUTC(nextOrderDate, 1), s);
    } else {
      nextNextDelivery = nextOrderDate;
    }
  } else if (deliveryDays.length && deliveryDate) {
    const s = daysUntilNextDow(addDaysUTC(deliveryDate, 1), deliveryDays) ?? 7;
    nextNextDelivery = addDaysUTC(addDaysUTC(deliveryDate, 1), s);
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
