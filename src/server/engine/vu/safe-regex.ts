
import "server-only";
import vm from "node:vm";

const MAX_INPUT_CHARS = 200_000;
const TIMEOUT_MS = 100;

// Contexte isolé pour exécuter les expressions régulières.
const context = vm.createContext({ pattern: "", text: "" });

const script = new vm.Script(
  "JSON.stringify((() => { const m = new RegExp(pattern).exec(text); return m ? Array.from(m) : null; })())",
);

// Préchauffage avec une expression fixe et non dangereuse.
// Évite que le premier appel supporte seul le coût d'initialisation.
context.pattern = "a";
context.text = "a";
script.runInContext(context);

// Réinitialisation du contexte.
context.pattern = "";
context.text = "";

export type RegexResult =
  | { ok: true; match: Array<string | null> | null }
  | { ok: false; error: string };

export function safeRegexExec(pattern: string, text: string): RegexResult {
  context.pattern = pattern;
  context.text =
    text.length > MAX_INPUT_CHARS
      ? text.slice(0, MAX_INPUT_CHARS)
      : text;

  try {
    const out = script.runInContext(context, {
      timeout: TIMEOUT_MS,
    }) as string;

    return {
      ok: true,
      match: JSON.parse(out) as Array<string | null> | null,
    };
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code ===
      "ERR_SCRIPT_EXECUTION_TIMEOUT"
    ) {
      return {
        ok: false,
        error: `Expression régulière trop lente (plus de ${TIMEOUT_MS} ms) : motif rejeté.`,
      };
    }

    return {
      ok: false,
      error: `Expression régulière invalide : ${(err as Error).message}`,
    };
  }
}
