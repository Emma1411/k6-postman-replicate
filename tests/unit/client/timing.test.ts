import { describe, expect, it } from "vitest";
import { PHASE_ADVICE, breakdownTimings } from "@/client/features/requests/timing";

describe("breakdownTimings", () => {
  it("calcule les parts et désigne la phase dominante", () => {
    const b = breakdownTimings({ dnsMs: 4, connectMs: 12, tlsMs: 18, ttfbMs: 32, transferMs: 5, totalMs: 71 });
    expect(b.dominant).toBe("ttfb");
    expect(b.unattributedMs).toBe(0);
    const share = (key: string) => b.phases.find((p) => p.key === key)?.share ?? 0;
    expect(share("ttfb")).toBeCloseTo(32 / 71, 5);
    expect(b.phases.reduce((t, p) => t + (p.share ?? 0), 0)).toBeCloseTo(1, 5);
  });

  it("gère une connexion réutilisée (phases absentes)", () => {
    const b = breakdownTimings({ dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: 20, transferMs: 5, totalMs: 25 });
    expect(b.phases.find((p) => p.key === "dns")?.share).toBeNull();
    expect(b.phases.find((p) => p.key === "tls")?.ms).toBeNull();
    expect(b.dominant).toBe("ttfb");
  });

  it("signale le temps non attribué quand le total dépasse la somme des phases", () => {
    const b = breakdownTimings({ dnsMs: 1, connectMs: 1, tlsMs: null, ttfbMs: 5, transferMs: 1, totalMs: 20 });
    expect(b.unattributedMs).toBe(12);
    const sumShares = b.phases.reduce((t, p) => t + (p.share ?? 0), 0);
    expect(sumShares).toBeCloseTo(8 / 20, 5);
  });

  it("n'invente pas de phase dominante quand tout est nul", () => {
    const b = breakdownTimings({ dnsMs: 0, connectMs: 0, tlsMs: 0, ttfbMs: 0, transferMs: 0, totalMs: 0 });
    expect(b.dominant).toBeNull();
  });

  it("fournit un conseil pour chaque phase", () => {
    for (const advice of Object.values(PHASE_ADVICE)) {
      expect(advice.subject.length).toBeGreaterThan(5);
      expect(advice.text.length).toBeGreaterThan(40);
    }
  });
});