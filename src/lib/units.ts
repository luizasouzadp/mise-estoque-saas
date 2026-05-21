// Unit conversion utilities for recipe composition.
// Only mass (kg<->g) and volume (L<->ml) conversions are supported.
// Other units must match the ingredient's registered unit exactly.

export type UnitGroup = "mass" | "volume" | "other";

const GROUPS: Record<string, { group: UnitGroup; toBase: number; base: string }> = {
  kg: { group: "mass", toBase: 1000, base: "g" },
  g:  { group: "mass", toBase: 1, base: "g" },
  L:  { group: "volume", toBase: 1000, base: "ml" },
  ml: { group: "volume", toBase: 1, base: "ml" },
};

export function unitGroup(unit: string): UnitGroup {
  return GROUPS[unit]?.group ?? "other";
}

/** Units compatible with the ingredient's registered unit (always includes the unit itself). */
export function compatibleUnits(baseUnit: string): string[] {
  const g = GROUPS[baseUnit]?.group;
  if (!g) return [baseUnit];
  return Object.entries(GROUPS).filter(([, v]) => v.group === g).map(([k]) => k);
}

/** Convert a quantity from `fromUnit` to `toUnit`. Returns null if incompatible. */
export function convert(qty: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return qty;
  const f = GROUPS[fromUnit];
  const t = GROUPS[toUnit];
  if (!f || !t || f.group !== t.group) return null;
  // qty * fromBase / toBase
  return (qty * f.toBase) / t.toBase;
}
