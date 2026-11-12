import "server-only";

export interface HistogramSnapshot {
  /** Paires aplaties [index, compte, index, compte, …] des cases non vides. */
  sparse: number[];
  count: number;
  sum: number;
  min: number;
  max: number;
}

// Histogramme à précision relative constante (méthode HDR) : 3 chiffres significatifs,
// valeurs en microsecondes. Deux cases par valeur entière en dessous de 2048 µs (exact),
// puis l'erreur relative reste sous 1/1024 (≈ 0,1 %).
const SUB_BUCKET_COUNT = 2048;
const HALF = SUB_BUCKET_COUNT / 2;
const HALF_MAG = 10; // log2(HALF)
const MASK = SUB_BUCKET_COUNT - 1;

/** Valeur maximale enregistrable : 2^31 - 1 µs, soit environ 35,8 minutes. */
export const HISTOGRAM_MAX_VALUE = 2_147_483_647;

const BUCKETS_NEEDED = (() => {
  let smallestUntrackable = SUB_BUCKET_COUNT;
  let needed = 1;
  while (smallestUntrackable <= HISTOGRAM_MAX_VALUE) {
    smallestUntrackable *= 2;
    needed++;
  }
  return needed;
})();
const COUNTS_LENGTH = (BUCKETS_NEEDED + 1) * HALF;

function indexOf(value: number): number {
  const bucketIdx = 32 - Math.clz32(value | MASK) - (HALF_MAG + 1);
  const subIdx = value >>> bucketIdx;
  return ((bucketIdx + 1) << HALF_MAG) + (subIdx - HALF);
}

function rangeAt(index: number): { low: number; size: number } {
  let bucketIdx = (index >> HALF_MAG) - 1;
  let subIdx = (index & (HALF - 1)) + HALF;
  if (bucketIdx < 0) {
    subIdx -= HALF;
    bucketIdx = 0;
  }
  const size = 2 ** bucketIdx;
  return { low: subIdx * size, size };
}

export class Histogram {
  private readonly counts = new Uint32Array(COUNTS_LENGTH);
  count = 0;
  sum = 0;
  min = Infinity;
  max = 0;

  /** Enregistre une valeur en microsecondes (bornée à [0, HISTOGRAM_MAX_VALUE]). */
  record(valueUs: number): void {
    let v = Math.round(valueUs);
    if (v < 0) v = 0;
    else if (v > HISTOGRAM_MAX_VALUE) v = HISTOGRAM_MAX_VALUE;

    this.counts[indexOf(v)]++;
    this.count++;
    this.sum += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  /** Valeur (µs) sous laquelle se trouvent `percentile` % des mesures, bornée par min et max observés. */
  valueAtPercentile(percentile: number): number {
    if (this.count === 0) return 0;
    if (percentile >= 100) return this.max;

    const target = Math.max(1, Math.ceil((Math.max(0, percentile) * this.count) / 100));
    let seen = 0;
    for (let i = 0; i < this.counts.length; i++) {
      const c = this.counts[i];
      if (c === 0) continue;
      seen += c;
      if (seen >= target) {
        const { low, size } = rangeAt(i);
        return Math.min(Math.max(low + size - 1, this.min), this.max);
      }
    }
    return this.max;
  }

  mergeSnapshot(snapshot: HistogramSnapshot): void {
    if (snapshot.count === 0) return;
    const { sparse } = snapshot;
    for (let i = 0; i + 1 < sparse.length; i += 2) this.counts[sparse[i]] += sparse[i + 1];
    this.count += snapshot.count;
    this.sum += snapshot.sum;
    if (snapshot.min < this.min) this.min = snapshot.min;
    if (snapshot.max > this.max) this.max = snapshot.max;
  }

  /** Format léger, transmissible entre un worker et le thread principal. */
  toSnapshot(): HistogramSnapshot {
    const sparse: number[] = [];
    for (let i = 0; i < this.counts.length; i++) {
      const c = this.counts[i];
      if (c !== 0) sparse.push(i, c);
    }
    return { sparse, count: this.count, sum: this.sum, min: this.count === 0 ? 0 : this.min, max: this.max };
  }

  reset(): void {
    this.counts.fill(0);
    this.count = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = 0;
  }
}