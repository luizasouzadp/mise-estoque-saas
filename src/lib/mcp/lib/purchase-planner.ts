// Regra da lista de compras automática (doc "Lista de compras automática – Hangar").
//
//   cobertura = prazo + intervalo preferido (ou a cobertura mínima, o que for maior)
//   precisa pedir? disponível < mínimo, ou dias até acabar < dias até a entrega do próximo
//                  pedido possível + segurança
//   quanto = max(consumo da cobertura − disponível, mínimo − disponível, 0),
//            arredondado PARA CIMA pela embalagem
//   Dias fechados (closed_weekdays) não consomem: o consumo médio é por dia aberto e as
//   contas de consumo andam no calendário pulando os dias fechados.
//
// Funções puras (sem banco), para poder testar com exemplos.

import { roundToPack, orderText, type PackInfo } from "./packs";

export type PlannerSupplier = {
  id: string | null;
  name: string;
  order_days: number[] | null;
  delivery_days: number[] | null;
  lead_time_days: number | null;
  order_frequency: string | null;
  /** Intervalo preferido (vem da frequência: semanal 7, quinzenal 14, mensal 30). */
  preferred_interval_days: number | null;
  possible_interval_days: number | null;
  min_coverage_days: number | null;
  safety_days: number | null;
  min_order_value: number | null;
};

export type PlannerOrder = { qty: number; expected_at: string | null };

export type PlannerItem = PackInfo & {
  ingredient_id: string;
  name: string;
  avg_daily: number;
  /** Estoque efetivo (inclui pré-preparos pela ficha). */
  effective_stock: number;
  current_stock: number;
  last_count_date: string | null;
  min_stock: number;
  unit_cost: number;
  /** Encomendas pendentes, já na unidade do insumo. */
  orders: PlannerOrder[];
};

export type Schedule = {
  as_of_date: string;
  next_order_date: string;
  days_to_order: number;
  lead_days: number;
  next_delivery_date: string;
  possible_interval_days: number;
  preferred_interval_days: number | null;
  next_opportunity_delivery_date: string;
  /** Dias (a partir de as_of) até a entrega do próximo pedido possível. */
  days_to_next_opportunity_delivery: number;
  safety_days: number;
  coverage_days: number;
  coverage_end_date: string;
  /** Dias da semana em que o restaurante não abre (0=domingo … 6=sábado). */
  closed_weekdays: number[];
};

const DAY = 86400000;

export function parseDate(d: string): Date {
  return new Date(`${d.slice(0, 10)}T00:00:00Z`);
}
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY);
}
function validDows(days: number[] | null | undefined): number[] {
  return (days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}
/** Dias até o próximo dia da semana da lista, a partir de `from` (0 se for o próprio dia). */
function daysUntilDow(from: Date, dows: number[]): number {
  const base = from.getUTCDay();
  return Math.min(...dows.map((d) => (d - base + 7) % 7));
}

// ---------- Dias abertos ----------

function isOpenDay(d: Date, closed: number[]): boolean {
  return !closed.includes(d.getUTCDay());
}

/** Dias abertos em [start, start + days) (start = YYYY-MM-DD, contado desde o início do dia). */
export function openDaysIn(start: string, days: number, closed: number[]): number {
  const base = parseDate(start);
  let n = 0;
  for (let i = 0; i < Math.max(0, Math.round(days)); i++) if (isOpenDay(addDays(base, i), closed)) n++;
  return n;
}

/** Consumo médio por DIA ABERTO de uma série diária (YYYY-MM-DD → quantidade). */
export function avgPerOpenDay(series: { date: string; qty: number }[], closed: number[]): number {
  const open = series.filter((d) => isOpenDay(parseDate(d.date), closed)).length;
  const total = series.reduce((a, d) => a + d.qty, 0);
  return open > 0 ? total / open : 0;
}

/**
 * Dias de calendário (com fração) até o estoque acabar, a partir do início de `start`,
 * consumindo `avg` só nos dias abertos. null = sem consumo.
 */
export function daysUntilOutCalendar(
  available: number,
  avg: number,
  start: string,
  closed: number[],
): number | null {
  if (avg <= 0 || closed.length >= 7) return null;
  let remaining = Math.max(0, available);
  const base = parseDate(start);
  for (let i = 0; i < 3660; i++) {
    if (!isOpenDay(addDays(base, i), closed)) continue;
    // Tolerância: somar dia a dia acumula resíduos (12 dias exatos não viram 11,9999).
    if (remaining < avg - 1e-9 * Math.max(1, avg)) return i + Math.max(0, remaining) / avg;
    remaining -= avg;
  }
  return 3660;
}

/** Agenda do fornecedor vista de `asOf` (YYYY-MM-DD). */
export function supplierSchedule(
  s: PlannerSupplier,
  asOf: string,
  defaultHorizon: number,
  safetyOverride?: number,
  closedWeekdays: number[] = [],
): Schedule {
  const today = parseDate(asOf);
  const orderDays = validDows(s.order_days);
  const deliveryDays = validDows(s.delivery_days);

  const daysToOrder = orderDays.length ? daysUntilDow(today, orderDays) : 0;
  const orderDate = addDays(today, daysToOrder);

  // Prazo: com dia de entrega fixo, o primeiro dia de entrega DEPOIS do pedido;
  // sem dia fixo, lead_time_days.
  const leadFor = (order: Date) =>
    deliveryDays.length
      ? 1 + daysUntilDow(addDays(order, 1), deliveryDays)
      : Math.max(0, s.lead_time_days ?? 0);
  const lead = leadFor(orderDate);

  // Intervalo da frequência: semanal 7, quinzenal 14, mensal 30, sob demanda 1.
  const preferred = s.preferred_interval_days ?? null;
  const frequencyInterval = s.order_frequency === "on_demand" ? 1 : preferred;
  // Possível: o cadastrado; senão, com dias de pedido → 7 (pode pedir toda semana);
  // senão, o intervalo da frequência.
  const possible =
    s.possible_interval_days ?? (orderDays.length ? 7 : (frequencyInterval ?? 7));

  const nextOpportunityOrder = addDays(orderDate, possible);
  const nextOpportunityDelivery = addDays(nextOpportunityOrder, leadFor(nextOpportunityOrder));

  const effPreferred = preferred ?? (orderDays.length ? 7 : null);
  const minCov = Math.max(0, s.min_coverage_days ?? 0);
  const coverage =
    effPreferred != null
      ? Math.max(daysToOrder + lead + effPreferred, minCov)
      : Math.max(defaultHorizon, minCov);

  return {
    as_of_date: asOf,
    next_order_date: isoDate(orderDate),
    days_to_order: daysToOrder,
    lead_days: lead,
    next_delivery_date: isoDate(addDays(orderDate, lead)),
    possible_interval_days: possible,
    preferred_interval_days: effPreferred,
    next_opportunity_delivery_date: isoDate(nextOpportunityDelivery),
    days_to_next_opportunity_delivery: daysBetween(asOf, isoDate(nextOpportunityDelivery)),
    safety_days: safetyOverride ?? s.safety_days ?? 2,
    coverage_days: coverage,
    coverage_end_date: isoDate(addDays(today, coverage)),
    closed_weekdays: validDows(closedWeekdays),
  };
}

const r3 = (n: number) => Number(n.toFixed(3));
const fmt = (n: number) => r3(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export type ItemDecision = {
  ingredient_id: string;
  name: string;
  unit: string;
  avg_daily: number;
  current_stock: number;
  effective_stock: number;
  last_count_date: string | null;
  days_since_count: number | null;
  estimated_stock: number;
  on_order: number;
  available_stock: number;
  days_until_out: number | null;
  /** Dia em que o estoque acaba (consumindo só nos dias abertos). */
  depletion_date: string | null;
  /** Consumo previsto na cobertura (só dias abertos). */
  coverage_consumption: number;
  min_stock: number;
  order: boolean;
  need_qty: number;
  qty: number;
  packs: number | null;
  pack_qty: number | null;
  pack_name: string | null;
  order_text: string | null;
  unit_cost: number;
  estimated_cost: number;
  decision_reason: string;
  /** Vai acabar antes da entrega deste pedido. */
  runs_out_before_delivery: boolean;
};

/** Estoque disponível e decisão de um item para a agenda do fornecedor. */
export function decideItem(item: PlannerItem, sch: Schedule): ItemDecision {
  const avg = Math.max(0, item.avg_daily);
  const closed = sch.closed_weekdays;
  const daysSinceCount =
    item.last_count_date != null ? Math.max(0, daysBetween(item.last_count_date, sch.as_of_date)) : null;
  // Contagem − consumo dos dias ABERTOS entre a contagem e hoje. O dia da contagem e o de
  // hoje não entram (a estimativa é do início do dia). O estoque efetivo já inclui as
  // compras lançadas desde a contagem e o que está em pré-preparo.
  const openSinceCount =
    item.last_count_date != null && daysSinceCount != null && daysSinceCount > 1
      ? openDaysIn(isoDate(addDays(parseDate(item.last_count_date), 1)), daysSinceCount - 1, closed)
      : 0;
  const estimated = Math.max(0, item.effective_stock - avg * openSinceCount);
  const onOrder = item.orders
    .filter((o) => o.expected_at == null || o.expected_at.slice(0, 10) <= sch.coverage_end_date)
    .reduce((a, o) => a + o.qty, 0);
  const available = estimated + onOrder;
  const daysUntilOut = daysUntilOutCalendar(available, avg, sch.as_of_date, closed);
  const depletionDate =
    daysUntilOut != null ? isoDate(addDays(parseDate(sch.as_of_date), Math.floor(daysUntilOut))) : null;

  const reach = sch.days_to_next_opportunity_delivery;
  const belowMin = item.min_stock > 0 && available < item.min_stock;
  const runsOut = daysUntilOut != null && daysUntilOut < reach + sch.safety_days;
  const coverageConsumption = avg * openDaysIn(sch.as_of_date, sch.coverage_days, closed);
  const needQty = Math.max(coverageConsumption - available, item.min_stock - available, 0);
  const order = (belowMin || runsOut) && needQty > 0;

  const rounded = order ? roundToPack(needQty, item) : roundToPack(0, item);
  const onOrderTxt = onOrder > 0 ? ` (já conta ${fmt(onOrder)} ${item.unit} encomendados)` : "";
  const outTxt = depletionDate ? ` (acaba ${depletionDate.slice(8, 10)}/${depletionDate.slice(5, 7)})` : "";
  let reason: string;
  if (order && runsOut) {
    reason = `aguenta ${fmt(daysUntilOut ?? 0)} dias${outTxt}${onOrderTxt}; a entrega do próximo pedido possível é em ${reach} dias + ${sch.safety_days} de segurança → pedir para ${sch.coverage_days} dias`;
  } else if (order) {
    reason = `abaixo do mínimo (${fmt(available)} de ${fmt(item.min_stock)} ${item.unit})${onOrderTxt} → pedir até o mínimo ou ${sch.coverage_days} dias de consumo, o que for maior`;
  } else if (belowMin || runsOut) {
    reason = `acaba antes da próxima entrega possível, mas o disponível já cobre os ${sch.coverage_days} dias de cobertura${onOrderTxt} → não pedir`;
  } else if (avg <= 0) {
    reason = `sem consumo registrado e acima do mínimo${onOrderTxt} → não pedir`;
  } else {
    reason = `aguenta ${fmt(daysUntilOut ?? 0)} dias${outTxt}${onOrderTxt}, próxima entrega possível em ${reach} (+${sch.safety_days} de segurança) → esperar`;
  }

  const unitCost = Math.max(0, item.unit_cost);
  return {
    ingredient_id: item.ingredient_id,
    name: item.name,
    unit: item.unit,
    avg_daily: r3(avg),
    current_stock: item.current_stock,
    effective_stock: item.effective_stock,
    last_count_date: item.last_count_date,
    days_since_count: daysSinceCount,
    estimated_stock: estimated,
    on_order: onOrder,
    available_stock: available,
    days_until_out: daysUntilOut != null ? Number(daysUntilOut.toFixed(1)) : null,
    depletion_date: depletionDate,
    coverage_consumption: r3(coverageConsumption),
    min_stock: item.min_stock,
    order,
    need_qty: order ? needQty : 0,
    qty: rounded.qty,
    packs: rounded.packs,
    pack_qty: rounded.pack_qty,
    pack_name: rounded.pack_name,
    order_text: order ? orderText(rounded.qty, rounded.packs, rounded.pack_name, item.unit) : null,
    unit_cost: unitCost,
    estimated_cost: Number((rounded.qty * unitCost).toFixed(2)),
    decision_reason: reason,
    runs_out_before_delivery: daysUntilOut != null && daysUntilOut < sch.days_to_order + sch.lead_days,
  };
}

export type FillSuggestion = {
  ingredient_id: string;
  name: string;
  unit: string;
  add_qty: number;
  add_packs: number | null;
  pack_name: string | null;
  add_cost: number;
  days_until_out: number | null;
  already_in_order: boolean;
};

/**
 * Completa o pedido mínimo: itens do mesmo fornecedor, começando pelos que acabam antes
 * (já contando o que entra neste pedido), uma embalagem por vez até cobrir o que falta.
 * Evita uma embalagem que passe muito do que falta quando há opção menor.
 * Fornecedor com um item só → sobe esse item.
 */
export function fillToMinimum(
  missing: number,
  decisions: ItemDecision[],
  packs: Map<string, PackInfo>,
): FillSuggestion[] {
  if (missing <= 0) return [];
  const daysAfterOrder = (d: ItemDecision) =>
    d.avg_daily > 0 ? (d.available_stock + d.qty) / d.avg_daily : Infinity;
  const candidates = decisions
    .filter((d) => d.unit_cost > 0)
    .sort((a, b) => daysAfterOrder(a) - daysAfterOrder(b));
  if (!candidates.length) return [];
  const step = (d: ItemDecision) => {
    const pack = Number(packs.get(d.ingredient_id)?.purchase_pack_qty ?? 0);
    if (pack > 0) return pack;
    // Sem embalagem: 1 unidade, ou ~1 semana de consumo para itens a granel.
    return d.unit === "un" ? 1 : Math.max(r3(d.avg_daily * 7), 1);
  };
  const stepCost = (d: ItemDecision) => step(d) * d.unit_cost;
  const added = new Map<string, number>();
  let remaining = missing;
  let cursor = 0;
  for (let n = 0; n < 500 && remaining > 1e-9; n++) {
    // Próximo da fila (em rodízio) que caiba no que falta; se nenhum couber,
    // o de menor custo que feche o pedido.
    let pick: ItemDecision | undefined;
    for (let k = 0; k < candidates.length; k++) {
      const c = candidates[(cursor + k) % candidates.length];
      if (stepCost(c) <= remaining + 1e-9) {
        pick = c;
        cursor = (cursor + k + 1) % candidates.length;
        break;
      }
    }
    pick ??= [...candidates].sort((a, b) => stepCost(a) - stepCost(b))[0];
    added.set(pick.ingredient_id, (added.get(pick.ingredient_id) ?? 0) + step(pick));
    remaining -= stepCost(pick);
  }
  return candidates
    .filter((d) => added.has(d.ingredient_id))
    .map((d) => {
      const q = added.get(d.ingredient_id)!;
      const pack = Number(packs.get(d.ingredient_id)?.purchase_pack_qty ?? 0);
      return {
        ingredient_id: d.ingredient_id,
        name: d.name,
        unit: d.unit,
        add_qty: r3(q),
        add_packs: pack > 0 ? Math.round(q / pack) : null,
        pack_name: pack > 0 ? (packs.get(d.ingredient_id)?.purchase_pack_name ?? null) : null,
        add_cost: Number((q * d.unit_cost).toFixed(2)),
        days_until_out: d.days_until_out,
        already_in_order: d.order,
      };
    });
}

/**
 * Prévia do próximo pedido (quinzenais e mensais): o que vai precisar no pedido seguinte,
 * para decidir se já junta neste.
 */
export function nextOrderPreview(
  s: PlannerSupplier,
  sch: Schedule,
  items: PlannerItem[],
  decisions: Map<string, ItemDecision>,
  defaultHorizon: number,
) {
  const interval = sch.preferred_interval_days ?? sch.possible_interval_days;
  const nextOrderDate = isoDate(addDays(parseDate(sch.next_order_date), interval));
  const nextSch = supplierSchedule(s, nextOrderDate, defaultHorizon, sch.safety_days, sch.closed_weekdays);
  const elapsedOpen = openDaysIn(sch.as_of_date, daysBetween(sch.as_of_date, nextOrderDate), sch.closed_weekdays);
  const out: Array<Pick<ItemDecision, "ingredient_id" | "name" | "unit" | "qty" | "packs" | "pack_name" | "order_text" | "estimated_cost" | "decision_reason">> = [];
  for (const item of items) {
    const now = decisions.get(item.ingredient_id);
    if (!now || now.order) continue;
    // Situação projetada no dia do próximo pedido.
    const projected: PlannerItem = {
      ...item,
      effective_stock: Math.max(0, now.available_stock - item.avg_daily * elapsedOpen),
      last_count_date: null,
      orders: [],
    };
    const d = decideItem(projected, nextSch);
    if (!d.order) continue;
    out.push({
      ingredient_id: d.ingredient_id,
      name: d.name,
      unit: d.unit,
      qty: d.qty,
      packs: d.packs,
      pack_name: d.pack_name,
      order_text: d.order_text,
      estimated_cost: d.estimated_cost,
      decision_reason: d.decision_reason,
    });
  }
  return {
    next_order_date: nextOrderDate,
    items: out,
    estimated_total: Number(out.reduce((a, i) => a + i.estimated_cost, 0).toFixed(2)),
  };
}
