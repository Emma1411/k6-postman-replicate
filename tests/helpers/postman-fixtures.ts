export const V21 = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

export const col = (item: unknown[], extra: Record<string, unknown> = {}) => ({
  info: { name: "Test", schema: V21 },
  item,
  ...extra,
});

export const req = (name: string, request: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name,
  request,
  ...extra,
});

/** Identifiants déterministes : id1, id2, … */
export const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

export const basicAuth = { type: "basic", basic: [{ key: "username", value: "u" }, { key: "password", value: "p" }] };