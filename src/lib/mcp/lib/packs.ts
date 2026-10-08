import { convert } from "../../units";

// Embalagem de compra dos insumos (fardo de 12, caixa de 30 kg, garrafa 1 L…).

export type PackInfo = {
  unit: string;
  purchase_pack_qty?: number | null;
  purchase_pack_name?: string | null;
};

function plain(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const UNIT_ALIASES: Record<string, string> = {
  kg: "kg", kgs: "kg", quilo: "kg", quilos: "kg",
  g: "g", gr: "g", grama: "g", gramas: "g",
  l: "L", lt: "L", lts: "L", litro: "L", litros: "L",
  ml: "ml",
  un: "un", und: "un", unid: "un", unidade: "un", unidades: "un", u: "un", pc: "un", peca: "un",
};

/** Normaliza a unidade (Kg → kg, litro → L, und → un). */
export function normalizeUnit(unit: string | null | undefined): string {
  const p = plain(unit).replace(/\.$/, "");
  return UNIT_ALIASES[p] ?? p;
}

const PACK_WORDS = new Set([
  "caixa", "caixas", "cx", "fardo", "fardos", "fd", "pacote", "pacotes", "pct", "pcte",
  "garrafa", "garrafas", "saco", "sacos", "balde", "baldes", "bandeja", "bandejas",
  "rodela", "rodelas", "emb", "embalagem", "embalagens", "pack", "engradado", "galao",
]);

/** Conversão memorizada na entrada de nota: 1 from_unit = factor (unidade do insumo). */
export type UnitAlias = { from_unit: string; factor: number };

/**
 * Embalagem de compra a partir de uma conversão memorizada na nota (1 CX = 30 kg →
 * caixa de 30). null quando é só troca de medida (kg→g) ou a mesma unidade.
 */
export function packFromAlias(
  fromUnit: string,
  factor: number,
  ingUnit: string,
): { purchase_pack_qty: number; purchase_pack_name: string } | null {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(ingUnit);
  if (!from || !(factor > 0) || factor === 1 || from === to) return null;
  if (convert(1, from, to) !== null) return null;
  return { purchase_pack_qty: factor, purchase_pack_name: fromUnit.trim().toLowerCase() };
}

/**
 * Converte a quantidade de uma encomenda para a unidade do insumo:
 * mesma unidade → igual; kg↔g, L↔ml → converte; conversão memorizada na nota →
 * multiplica pelo fator; nome da embalagem (caixa, fardo…) → multiplica por
 * purchase_pack_qty (1 caixa de mussarela = 30 kg).
 */
export function toIngredientUnit(
  qty: number,
  orderUnit: string | null | undefined,
  ing: PackInfo,
  aliases: UnitAlias[] = [],
): { qty: number; converted_by: "same" | "unit" | "alias" | "pack" | "unknown" } {
  const from = normalizeUnit(orderUnit);
  const to = normalizeUnit(ing.unit);
  if (!from || from === to) return { qty, converted_by: "same" };
  const c = convert(qty, from, to);
  if (c !== null) return { qty: c, converted_by: "unit" };
  const alias = aliases.find((a) => normalizeUnit(a.from_unit) === from && Number(a.factor) > 0);
  if (alias) return { qty: qty * Number(alias.factor), converted_by: "alias" };
  const pack = Number(ing.purchase_pack_qty ?? 0);
  if (pack > 0) {
    const packName = plain(ing.purchase_pack_name);
    const firstWord = packName.split(" ")[0];
    const f = plain(orderUnit);
    if (PACK_WORDS.has(f) || (packName && (f === packName || f === firstWord))) {
      return { qty: qty * pack, converted_by: "pack" };
    }
  }
  return { qty, converted_by: "unknown" };
}

/**
 * Arredonda PARA CIMA pela embalagem. Sem embalagem: unidades inteiras para "un",
 * senão a quantidade calculada.
 */
export function roundToPack(
  need: number,
  ing: PackInfo,
): { qty: number; packs: number | null; pack_qty: number | null; pack_name: string | null } {
  if (need <= 0) return { qty: 0, packs: null, pack_qty: null, pack_name: null };
  const pack = Number(ing.purchase_pack_qty ?? 0);
  if (pack > 0) {
    // Tolerância para resíduos de ponto flutuante (16,0000001 kg não vira 2 caixas).
    const packs = Math.max(1, Math.ceil(need / pack - 1e-9));
    return {
      qty: packs * pack,
      packs,
      pack_qty: pack,
      pack_name: ing.purchase_pack_name?.trim() || null,
    };
  }
  const qty = normalizeUnit(ing.unit) === "un" ? Math.ceil(need - 1e-9) : need;
  return { qty, packs: null, pack_qty: null, pack_name: null };
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/** Texto da compra: "2 × fardo (24 un)" ou "3,5 kg". */
export function orderText(qty: number, packs: number | null, packName: string | null, unit: string) {
  if (packs != null) return `${packs} × ${packName ?? "embalagem"} (${fmt(qty)} ${unit})`;
  return `${fmt(qty)} ${unit}`;
}
