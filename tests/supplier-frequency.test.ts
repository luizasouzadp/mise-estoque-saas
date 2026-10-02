import { describe, expect, it } from "vitest";
import { frequencyIntervalDays, frequencyLabel } from "@/lib/supplier-frequency";

describe("frequencyIntervalDays", () => {
  it("converte a frequência em intervalo de dias", () => {
    expect(frequencyIntervalDays("weekly")).toBe(7);
    expect(frequencyIntervalDays("biweekly")).toBe(14);
    expect(frequencyIntervalDays("monthly")).toBe(30);
  });

  it("sob demanda ou sem frequência não tem intervalo", () => {
    expect(frequencyIntervalDays("on_demand")).toBeNull();
    expect(frequencyIntervalDays(null)).toBeNull();
    expect(frequencyIntervalDays("xyz")).toBeNull();
  });
});

describe("frequencyLabel", () => {
  it("mostra o nome e o intervalo", () => {
    expect(frequencyLabel("biweekly")).toBe("Quinzenal (a cada 14 dias)");
    expect(frequencyLabel("on_demand")).toBe("Sob demanda");
    expect(frequencyLabel(null)).toBe("Não definida");
  });
});
