// Frequência de compra do fornecedor e o intervalo (em dias) que ela representa.
// "Sob demanda" não tem intervalo fixo.

export type SupplierFrequency = "weekly" | "biweekly" | "monthly" | "on_demand";

export const SUPPLIER_FREQUENCIES: { v: SupplierFrequency; l: string }[] = [
  { v: "weekly", l: "Semanal" },
  { v: "biweekly", l: "Quinzenal" },
  { v: "monthly", l: "Mensal" },
  { v: "on_demand", l: "Sob demanda" },
];

const INTERVAL_DAYS: Record<SupplierFrequency, number | null> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  on_demand: null,
};

export function frequencyIntervalDays(frequency: string | null | undefined): number | null {
  if (!frequency) return null;
  return INTERVAL_DAYS[frequency as SupplierFrequency] ?? null;
}

export function frequencyLabel(frequency: string | null | undefined): string {
  const label = SUPPLIER_FREQUENCIES.find((f) => f.v === frequency)?.l;
  if (!label) return "Não definida";
  const days = frequencyIntervalDays(frequency);
  return days != null ? `${label} (a cada ${days} dias)` : label;
}
