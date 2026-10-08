import { describe, expect, it } from "vitest";
import { packFromAlias, toIngredientUnit } from "@/lib/mcp/lib/packs";

describe("packFromAlias", () => {
  it("embalagem memorizada na nota vira embalagem de compra", () => {
    expect(packFromAlias("CX", 30, "kg")).toEqual({ purchase_pack_qty: 30, purchase_pack_name: "cx" });
    expect(packFromAlias("FD", 12, "un")).toEqual({ purchase_pack_qty: 12, purchase_pack_name: "fd" });
  });

  it("troca de medida ou mesma unidade não é embalagem", () => {
    expect(packFromAlias("KG", 1000, "g")).toBeNull();
    expect(packFromAlias("L", 1000, "ml")).toBeNull();
    expect(packFromAlias("UN", 1, "un")).toBeNull();
    expect(packFromAlias("Kg", 2, "kg")).toBeNull();
    expect(packFromAlias("CX", 1, "kg")).toBeNull();
  });
});

describe("toIngredientUnit com conversão memorizada", () => {
  it("usa a conversão da nota antes da embalagem cadastrada", () => {
    const ing = { unit: "kg", purchase_pack_qty: 25, purchase_pack_name: "saco" };
    expect(toIngredientUnit(2, "CX", ing, [{ from_unit: "CX", factor: 30 }])).toEqual({
      qty: 60,
      converted_by: "alias",
    });
    expect(toIngredientUnit(2, "saco", ing, [{ from_unit: "CX", factor: 30 }])).toEqual({
      qty: 50,
      converted_by: "pack",
    });
  });

  it("sem conversão conhecida continua avisando", () => {
    expect(toIngredientUnit(3, "bandeja", { unit: "un" })).toEqual({ qty: 3, converted_by: "unknown" });
  });
});
