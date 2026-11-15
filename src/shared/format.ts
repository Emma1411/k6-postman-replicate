/** Nombre à la française : virgule décimale, espace insécable entre les milliers, zéros inutiles supprimés. */
export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(digits);
  if (Number(fixed) === 0) return "0";

  const negative = fixed.startsWith("-");
  const [integer, fraction = ""] = (negative ? fixed.slice(1) : fixed).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  const decimals = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${grouped}${decimals ? `,${decimals}` : ""}`;
}

/** Comme formatNumber, avec un « + » devant les valeurs positives. */
export function formatSigned(value: number, digits = 1): string {
  const text = formatNumber(value, digits);
  return value > 0 && text !== "0" && !text.startsWith("-") ? `+${text}` : text;
}