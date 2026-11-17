import type { CriteriaDraft, ProfileDraft } from "./profile";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function isProfileDraft(value: unknown): value is ProfileDraft {
  if (!isObj(value)) return false;
  return (
    ["ramp", "constant", "spike", "arrival-rate"].includes(value.kind as string) &&
    ["vus", "rampUpSeconds", "plateauSeconds", "rampDownSeconds", "rate", "thinkTimeMs"].every((k) => isNum(value[k]))
  );
}

export function isCriteriaDraft(value: unknown): value is CriteriaDraft {
  if (!isObj(value)) return false;
  const { p95, errors, checks } = value;
  return (
    isObj(p95) && typeof p95.enabled === "boolean" && isNum(p95.maxMs) &&
    isObj(errors) && typeof errors.enabled === "boolean" && isNum(errors.maxPercent) &&
    isObj(checks) && typeof checks.enabled === "boolean" && isNum(checks.minPercent) &&
    typeof value.failFast === "boolean" && isNum(value.failFastDelaySeconds)
  );
}