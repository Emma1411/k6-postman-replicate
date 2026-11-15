import vm from "node:vm";
import { bench, describe } from "vitest";

const PATTERN = '"id":(\\d+)';
const TEXT = JSON.stringify({ id: 12345, name: "emma", tags: ["a", "b"], note: "x".repeat(500) });

const context = vm.createContext({ pattern: PATTERN, text: TEXT, cache: new Map<string, unknown>() });
const compileEveryTime = new vm.Script("new RegExp(pattern).exec(text)");
const compileOnce = new vm.Script(
  "(cache.get(pattern) ?? (cache.set(pattern, new RegExp(pattern)), cache.get(pattern))).exec(text)",
);
const asJson = new vm.Script(
  "JSON.stringify((() => { const m = new RegExp(pattern).exec(text); return m ? Array.from(m) : null; })())",
);

describe("où part le coût de safeRegexExec", () => {
  bench("1. RegExp natif (motif recompilé)", () => {
    new RegExp(PATTERN).exec(TEXT);
  });
  bench("2. vm sans délai maximum, motif recompilé", () => {
    compileEveryTime.runInContext(context);
  });
  bench("3. vm avec délai maximum, motif recompilé", () => {
    compileEveryTime.runInContext(context, { timeout: 50 });
  });
  bench("4. vm avec délai maximum, motif en cache", () => {
    compileOnce.runInContext(context, { timeout: 50 });
  });
  bench("5. comme l'implémentation actuelle (délai + JSON aller-retour)", () => {
    JSON.parse(asJson.runInContext(context, { timeout: 50 }) as string);
  });
});