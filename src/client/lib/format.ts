const NUMBER = new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 1 });
const UNITS = ["o", "Kio", "Mio", "Gio"] as const;

export const formatInt = (n: number): string => NUMBER.format(n);

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${NUMBER.format(value)} ${UNITS[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${NUMBER.format(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** 71 → « 71 ms », 1900 → « 1,9 s ». */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${NUMBER.format(ms / 1000)} s` : `${NUMBER.format(ms)} ms`;
}

/** 0,0012 → « 0,12 % ». */
export function formatPercent(fraction: number): string {
  return `${new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 2 }).format(fraction * 100)} %`;
}

/** 75 → « 01:15 ». */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}