import type { StepResult, WorkflowRunResult } from "@/shared/types/workflow-result";

export const MASK = "••••••";

const SENSITIVE =
  /(token|secret|passw(?:or)?d|authorization|api[-_]?key|apikey|cookie|session|credential|bearer|private[-_]?key|access[-_]?key|signature)/i;

/** Un nom de variable, de paramètre ou de header qui évoque un secret. Heuristique : elle ne remplace pas une relecture. */
export const isSensitiveName = (name: string): boolean => SENSITIVE.test(name);

export const maskValue = (name: string, value: string): string => (isSensitiveName(name) ? MASK : value);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Masque les identifiants intégrés à l'URL et les paramètres de query sensibles. Fonctionne aussi avec des {{variables}}. */
export function redactUrl(url: string): string {
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#@]*@)/i, `$1${MASK}@`)
    .replace(/([?&])([^=&#]+)=([^&#]*)/g, (match, separator: string, name: string) =>
      isSensitiveName(safeDecode(name)) ? `${separator}${name}=${MASK}` : match,
    );
}

/** Masque, dans un texte libre, les jetons Bearer/Basic, les JWT et les valeurs associées à un nom sensible. */
export function redactText(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`)
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, MASK)
    .replace(
      /("?[A-Za-z0-9_-]*(?:token|secret|passw(?:or)?d|api[-_]?key)[A-Za-z0-9_-]*"?\s*[:=]\s*)("[^"]*"|[^\s,;&}\]]+)/gi,
      (_match, head: string, value: string) => `${head}${value.startsWith('"') ? `"${MASK}"` : MASK}`,
    );
}

const redactVariables = (variables: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, maskValue(key, value)]));

function redactStep(step: StepResult, includePreviews: boolean): StepResult {
  return {
    ...step,
    skippedReason: step.skippedReason === null ? null : redactText(step.skippedReason),
    response: step.response
      ? {
          ...step.response,
          finalUrl: step.response.finalUrl === null ? null : redactUrl(step.response.finalUrl),
          preview: includePreviews && step.response.preview !== null ? redactText(step.response.preview) : null,
        }
      : null,
    assertions: step.assertions.map((a) => ({
      ...a,
      label: redactText(a.label),
      message: a.message === null ? null : redactText(a.message),
    })),
    extracted: redactVariables(step.extracted),
    extractionErrors: step.extractionErrors.map(redactText),
    error: step.error ? { ...step.error, message: redactText(step.error.message) } : null,
  };
}

/** Copie expurgée d'un résultat de workflow ; l'original n'est pas modifié. */
export function redactWorkflowResult(result: WorkflowRunResult, includePreviews: boolean): WorkflowRunResult {
  return {
    ...result,
    steps: result.steps.map((s) => redactStep(s, includePreviews)),
    variables: redactVariables(result.variables),
  };
}