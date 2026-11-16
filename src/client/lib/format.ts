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