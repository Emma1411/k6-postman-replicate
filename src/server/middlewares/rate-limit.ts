import "server-only";
import { limits } from "@/server/config";
import { AppError } from "@/server/utils/errors";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fenêtre glissante en mémoire. Les requêtes refusées ne sont pas comptées. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly maxKeys: number;
  private readonly sweepEvery: number;
  private calls = 0;

  constructor(windowMs: number, max: number, maxKeys = 10_000, sweepEvery = 500) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.sweepEvery = sweepEvery;
  }

  get size(): number {
    return this.hits.size;
  }

  check(key: string, now: number = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (list.length >= this.max) {
      this.hits.set(key, list);
      const retryMs = list[0] + this.windowMs - now;
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
    }

    list.push(now);
    this.hits.set(key, list);
    this.maybeSweep(now);
    return { allowed: true, remaining: this.max - list.length, retryAfterSeconds: 0 };
  }

  private maybeSweep(now: number): void {
    this.calls += 1;
    if (this.calls % this.sweepEvery !== 0) return;

    const cutoff = now - this.windowMs;
    for (const [key, list] of this.hits) {
      if (list.length === 0 || list[list.length - 1] <= cutoff) this.hits.delete(key);
    }
    // Plafond de mémoire : on évince les plus anciennes entrées si trop de clés distinctes.
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

type Limiters = { general: SlidingWindowLimiter; loadRuns: SlidingWindowLimiter };
const globalStore = globalThis as unknown as { __apiLimiters?: Limiters };

/** Stocké sur globalThis pour survivre au rechargement des modules en développement. */
export function getLimiters(): Limiters {
  if (!globalStore.__apiLimiters) {
    globalStore.__apiLimiters = {
      general: new SlidingWindowLimiter(limits.rateLimit.windowSeconds * 1000, limits.rateLimit.maxRequests),
      loadRuns: new SlidingWindowLimiter(3_600_000, limits.rateLimit.maxLoadRunsPerHour),
    };
  }
  return globalStore.__apiLimiters;
}

export function enforceRateLimit(kind: "general" | "loadRuns", key: string): void {
  const result = getLimiters()[kind].check(key);
  if (!result.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      kind === "loadRuns"
        ? "Trop de tests de charge lancés : réessaie plus tard."
        : "Trop de requêtes : réessaie plus tard.",
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
}