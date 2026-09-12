import { describe, it, expect } from "vitest";
import { resolveAccessDecision } from "@/lib/access-guard";

describe("resolveAccessDecision", () => {
  it("permite acesso quando o restaurante esta ativo", () => {
    expect(resolveAccessDecision({ isPlatformAdmin: false, restaurantStatus: "ativo" })).toBe("allow");
  });

  it("bloqueia quando o restaurante esta bloqueado", () => {
    expect(resolveAccessDecision({ isPlatformAdmin: false, restaurantStatus: "bloqueado" })).toBe("block");
  });

  it("bloqueia quando o status nao pode ser determinado (fail-closed)", () => {
    expect(resolveAccessDecision({ isPlatformAdmin: false, restaurantStatus: null })).toBe("block");
  });

  it("admin da plataforma sempre passa, mesmo sem restaurante", () => {
    expect(resolveAccessDecision({ isPlatformAdmin: true, restaurantStatus: null })).toBe("allow");
  });
});
