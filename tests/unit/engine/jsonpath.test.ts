import { describe, it, expect } from "vitest";
import { JsonPathError, queryJsonPath } from "@/server/engine/vu/jsonpath";

const doc = {
  store: { name: "s", items: [{ id: 1, tags: ["a", "b"] }, { id: 2, tags: [] }], "weird-key": 5 },
  nul: null,
  arr: [10, 20, 30],
};

describe("queryJsonPath", () => {
  it.each([
    ["$.store.name", ["s"]],
    ["$.store.items[0].id", [1]],
    ["$.store.items[-1].id", [2]],
    ["$['store']['weird-key']", [5]],
    ['$["store"].name', ["s"]],
    ["$.store.items[*].id", [1, 2]],
    ["$.store.items.length", [2]],
    ["$.arr[1]", [20]],
    ["$.nul", [null]],
    ["$.missing.x", []],
    ["$.arr[5]", []],
    ["$.__proto__", []],
    ["$.constructor", []],
  ])("évalue %s", (path, expected) => {
    expect(queryJsonPath(doc, path)).toEqual(expected);
  });

  it("renvoie la racine pour $", () => {
    expect(queryJsonPath(doc, "$")).toEqual([doc]);
  });

  it("gère le joker sur un objet", () => {
    expect(queryJsonPath(doc, "$.store.*")).toHaveLength(3);
  });

  it.each(["store.name", "$..name", "$.items[?(@.id==1)]", "$.a[", "$.a[1:2]", "$.", "$#"])(
    "rejette %s",
    (path) => {
      expect(() => queryJsonPath(doc, path)).toThrow(JsonPathError);
    },
  );
});