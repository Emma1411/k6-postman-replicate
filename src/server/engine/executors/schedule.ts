export interface Stage {
  durationSeconds: number;
  target: number;
}

/**
 * Nombre de VUs gérés par le worker `index` quand le test en demande `target` au total.
 * Les VUs 1..target sont répartis en tourniquet : le VU numéro v appartient au worker (v - 1) % count.
 */
export function ownedVuCount(target: number, index: number, count: number): number {
  return Math.max(0, Math.floor((target + count - 1 - index) / count));
}

export function totalStagesSeconds(stages: Stage[]): number {
  return stages.reduce((sum, s) => sum + s.durationSeconds, 0);
}

/** Valeur cible à l'instant t (secondes), par interpolation linéaire entre les stages. */
export function rampingTarget(startValue: number, stages: Stage[], tSeconds: number): number {
  let start = 0;
  let from = startValue;
  for (const stage of stages) {
    const end = start + stage.durationSeconds;
    if (tSeconds < end) {
      const fraction = (tSeconds - start) / stage.durationSeconds;
      return from + (stage.target - from) * fraction;
    }
    start = end;
    from = stage.target;
  }
  return from;
}

interface Segment {
  start: number;
  duration: number;
  a: number; // cadence au début du segment (itérations par seconde)
  b: number; // cadence à la fin
  cumStart: number; // arrivées attendues avant ce segment
  total: number; // arrivées attendues dans ce segment
}

/**
 * Calendrier des arrivées pour les executors à cadence imposée.
 * La k-ième itération (à partir de 1) démarre quand le nombre cumulé d'arrivées attendues atteint k.
 * Tous les workers calculent le même calendrier ; chacun ne traite que ses itérations.
 */
export class ArrivalSchedule {
  private readonly segments: Segment[] = [];
  private segmentIndex = 0;
  private counter = 0;

  constructor(startRate: number, stages: Stage[], timeUnitSeconds: number) {
    let t = 0;
    let cumulative = 0;
    let from = startRate / timeUnitSeconds;
    for (const stage of stages) {
      const to = stage.target / timeUnitSeconds;
      const total = ((from + to) / 2) * stage.durationSeconds;
      this.segments.push({ start: t, duration: stage.durationSeconds, a: from, b: to, cumStart: cumulative, total });
      t += stage.durationSeconds;
      cumulative += total;
      from = to;
    }
  }

  static constant(rate: number, timeUnitSeconds: number, durationSeconds: number): ArrivalSchedule {
    return new ArrivalSchedule(rate, [{ durationSeconds, target: rate }], timeUnitSeconds);
  }

  /** Instant (secondes depuis le départ) de la prochaine itération, ou null quand le test est terminé. */
  next(): number | null {
    const target = this.counter + 1;
    while (this.segmentIndex < this.segments.length) {
      const seg = this.segments[this.segmentIndex];
      if (target <= seg.cumStart + seg.total + 1e-9) {
        // Résout a·τ + c·τ² = n, avec c = (b - a) / (2·durée), sous une forme stable numériquement.
        const n = Math.max(0, target - seg.cumStart);
        const c = (seg.b - seg.a) / (2 * seg.duration);
        const discriminant = Math.max(0, seg.a * seg.a + 4 * c * n);
        const denominator = seg.a + Math.sqrt(discriminant);
        const tau = denominator > 0 ? (2 * n) / denominator : 0;
        this.counter++;
        return seg.start + Math.min(seg.duration, tau);
      }
      this.segmentIndex++;
    }
    return null;
  }
}