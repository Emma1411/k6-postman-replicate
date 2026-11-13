export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : sum(values) / values.length;
}

/** Percentile avec interpolation linéaire. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export const median = (values: number[]): number | null => percentile(values, 50);

/** Coefficient de corrélation de Pearson, null si indéfini (moins de 3 points ou aucune variation). */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = sum(xs.slice(0, n)) / n;
  const my = sum(ys.slice(0, n)) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/** Pente de la régression linéaire de y en fonction de x, null si indéfinie. */
export function slope(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = sum(xs.slice(0, n)) / n;
  const my = sum(ys.slice(0, n)) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  return sxx === 0 ? null : sxy / sxx;
}

export function max(values: number[]): number {
  let best = -Infinity;
  for (const v of values) if (v > best) best = v;
  return best === -Infinity ? 0 : best;
}

export interface Regression {
  slope: number;
  intercept: number;
  /** Coefficient de corrélation. */
  r: number;
  n: number;
  slopeStdErr: number;
}

/** Régression linéaire par moindres carrés ; null avec moins de 3 points ou sans variation de x. */
export function linearRegression(xs: number[], ys: number[]): Regression | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = sum(xs.slice(0, n)) / n;
  const my = sum(ys.slice(0, n)) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i] - (intercept + slope * xs[i])) ** 2;

  return {
    slope,
    intercept,
    r: syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy),
    n,
    slopeStdErr: n > 2 ? Math.sqrt(rss / (n - 2) / sxx) : Infinity,
  };
}