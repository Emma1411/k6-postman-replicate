import { describe, it, expect } from "vitest";
import { getClientIp } from "@/server/utils/client-ip";

const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

describe("getClientIp", () => {
  it("lit la dernière entrée avec 1 proxy de confiance", () => {
    expect(getClientIp(h("1.1.1.1, 2.2.2.2"), 1)).toBe("2.2.2.2");
  });

  it("ignore les entrées de gauche, qui peuvent être forgées", () => {
    expect(getClientIp(h("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
  });

  it("lit l'avant-dernière entrée avec 2 proxys de confiance", () => {
    expect(getClientIp(h("1.1.1.1, 2.2.2.2, 3.3.3.3"), 2)).toBe("2.2.2.2");
  });

  it("renvoie unknown si on ne fait pas confiance aux proxys", () => {
    expect(getClientIp(h("1.1.1.1"), 0)).toBe("unknown");
  });

  it("renvoie unknown sans en-tête ou avec une valeur invalide", () => {
    expect(getClientIp(h(), 1)).toBe("unknown");
    expect(getClientIp(h("abc"), 1)).toBe("unknown");
    expect(getClientIp(h("1.1.1.1"), 2)).toBe("unknown");
  });
});