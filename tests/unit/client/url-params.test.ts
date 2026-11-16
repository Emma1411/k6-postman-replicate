import { describe, expect, it } from "vitest";
import { applyParams, mergeParamsFromUrl, parseQuery } from "@/client/features/requests/url-params";

const row = (key: string, value: string, enabled = true) => ({ key, value, enabled });

describe("parseQuery", () => {
  it("lit les paramètres de l'URL, avant le fragment", () => {
    expect(parseQuery("https://x.test/a?page=1&limit=20#top")).toEqual([row("page", "1"), row("limit", "20")]);
  });

  it("décode les valeurs et accepte une clé sans valeur", () => {
    expect(parseQuery("https://x.test/a?q=caf%C3%A9&flag")).toEqual([row("q", "café"), row("flag", "")]);
  });

  it("laisse les variables intactes", () => {
    expect(parseQuery("{{base}}/p?id={{id}}")).toEqual([row("id", "{{id}}")]);
  });

  it("renvoie une liste vide sans requête", () => {
    expect(parseQuery("https://x.test/a")).toEqual([]);
  });
});

describe("applyParams", () => {
  it("réécrit la requête avec les lignes actives seulement", () => {
    const params = [row("page", "2"), row("debug", "1", false), row("q", "a b")];
    expect(applyParams("https://x.test/a?page=1", params)).toBe("https://x.test/a?page=2&q=a%20b");
  });

  it("supprime le « ? » quand il ne reste aucun paramètre", () => {
    expect(applyParams("https://x.test/a?page=1", [row("page", "1", false)])).toBe("https://x.test/a");
  });

  it("conserve le fragment et les variables", () => {
    expect(applyParams("{{base}}/p#frag", [row("id", "{{id}}")])).toBe("{{base}}/p?id={{id}}#frag");
  });

  it("revient à l'URL d'origine après un aller-retour", () => {
    const url = "https://x.test/a?page=1&limit=20";
    expect(applyParams(url, parseQuery(url))).toBe(url);
  });
});

describe("mergeParamsFromUrl", () => {
  it("garde les lignes désactivées quand l'URL change", () => {
    const merged = mergeParamsFromUrl("https://x.test/a?page=3", [row("page", "1"), row("debug", "1", false)]);
    expect(merged).toEqual([row("page", "3"), row("debug", "1", false)]);
  });
});