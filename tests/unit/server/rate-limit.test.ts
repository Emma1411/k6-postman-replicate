import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "@/server/middlewares/rate-limit";

describe("SlidingWindowLimiter", () => {
  it("bloque au-delà du maximum dans la fenêtre", () => {
    const limiter = new SlidingWindowLimiter(1000, 3);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 100).allowed).toBe(true);
    expect(limiter.check("a", 200).remaining).toBe(0);

    const denied = limiter.check("a", 300);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(1);
  });

  it("autorise à nouveau quand la fenêtre a glissé", () => {
    const limiter = new SlidingWindowLimiter(1000, 2);
    limiter.check("a", 0);
    limiter.check("a", 500);
    expect(limiter.check("a", 900).allowed).toBe(false);
    expect(limiter.check("a", 1001).allowed).toBe(true);
  });

  it("isole les clés", () => {
    const limiter = new SlidingWindowLimiter(1000, 1);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 1).allowed).toBe(false);
  });

  it("ne compte pas les requêtes refusées", () => {
    const limiter = new SlidingWindowLimiter(1000, 1);
    limiter.check("a", 0);
    limiter.check("a", 500); // refusée
    expect(limiter.check("a", 1001).allowed).toBe(true);
  });

  it("limite le nombre de clés en mémoire", () => {
    const limiter = new SlidingWindowLimiter(60_000, 5, 2, 1);
    limiter.check("a", 0);
    limiter.check("b", 1);
    limiter.check("c", 2);
    limiter.check("d", 3);
    expect(limiter.size).toBeLessThanOrEqual(2);
  });
});