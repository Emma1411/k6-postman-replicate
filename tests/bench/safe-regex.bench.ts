import { bench, describe } from "vitest";
import { safeRegexExec } from "@/server/engine/vu/safe-regex";

const body = JSON.stringify({
  token: "abc123",
  items: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}` })),
});
const pattern = '"token":"([a-z0-9]+)"';

describe("extraction par regex", () => {
  bench("safeRegexExec (vm + délai maximum)", () => {
    safeRegexExec(pattern, body);
  });

  bench("RegExp natif (référence, non protégé)", () => {
    new RegExp(pattern).exec(body);
  });
});