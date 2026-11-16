import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, setChallengeHandler, setFetch } from "@/client/api/client";
import { ApiError, describeError } from "@/client/api/errors";

interface Call {
  input: string;
  init: RequestInit;
}

function fakeFetch(handler: (call: number, input: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string, init: RequestInit) => {
    calls.push({ input, init });
    return handler(calls.length, input, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const challenge = () => json({ error: { code: "CHALLENGE_REQUIRED", message: "Vérification requise." } }, 403);

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      return err.code;
    }
    return undefined;
  }

  return undefined;
};

afterEach(() => {
  setFetch(null);
  setChallengeHandler(null);
});

describe("apiFetch : requêtes", () => {
  it("fait un GET sans corps ni en-tête de contenu", async () => {
    const f = fakeFetch(() => json({ ok: 1 }));
    setFetch(f.fn);
    expect(await apiFetch("/api/config")).toEqual({ ok: 1 });
    expect(f.calls[0].init.method).toBe("GET");
    expect(f.calls[0].init.body).toBeUndefined();
    expect(f.calls[0].init.headers).toBeUndefined();
    expect(f.calls[0].init.credentials).toBe("same-origin");
  });

  it("envoie du JSON en POST quand il y a un corps", async () => {
    const f = fakeFetch(() => json({ ok: true }));
    setFetch(f.fn);
    await apiFetch("/api/x", { body: { a: 1 } });
    expect(f.calls[0].init.method).toBe("POST");
    expect(f.calls[0].init.body).toBe('{"a":1}');
    expect(f.calls[0].init.headers).toEqual({ "Content-Type": "application/json" });
  });
});

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      return err;
    }
    throw err;
  }

  throw new Error("Une ApiError était attendue.");
}

describe("apiFetch : erreurs", () => {
  it("convertit l'erreur du serveur en ApiError", async () => {
    setFetch(
      fakeFetch(() =>
        json(
          {
            error: {
              code: "SSRF_BLOCKED",
              message: "Destination refusée.",
              details: { x: 1 },
            },
          },
          403,
        ),
      ).fn,
    );

    const err = await expectApiError(apiFetch("/api/x"));

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("SSRF_BLOCKED");
    expect(err.status).toBe(403);
    expect(err.message).toBe("Destination refusée.");
    expect(err.details).toEqual({ x: 1 });
  });

  it("gère une réponse d'erreur qui n'est pas du JSON", async () => {
    setFetch(
      fakeFetch(
        () => new Response("<html>Bad gateway</html>", { status: 502 }),
      ).fn,
    );

    const err = await expectApiError(apiFetch("/api/x"));

    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("Erreur HTTP 502");
  });

  it("reconnaît un 429 sans corps", async () => {
    setFetch(fakeFetch(() => new Response(null, { status: 429 })).fn);

    expect(await codeOf(apiFetch("/api/x"))).toBe("RATE_LIMITED");
  });

  it("ignore un code d'erreur inconnu du client", async () => {
    setFetch(
      fakeFetch(() =>
        json({ error: { code: "NOUVEAU_CODE", message: "m" } }, 400),
      ).fn,
    );

    expect(await codeOf(apiFetch("/api/x"))).toBe("UNKNOWN");
  });

  it("signale une panne réseau et une annulation", async () => {
    setFetch(
      (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    );

    expect(await codeOf(apiFetch("/api/x"))).toBe("NETWORK_ERROR");

    const controller = new AbortController();
    controller.abort();

    setFetch(
      (async () => {
        throw new DOMException("aborted", "AbortError");
      }) as unknown as typeof fetch,
    );

    expect(
      await codeOf(apiFetch("/api/x", { signal: controller.signal })),
    ).toBe("ABORTED");
  });
});


describe("apiFetch : défi anti-robot", () => {
  it("lance le défi puis rejoue la requête une fois", async () => {
    let done = false;
    const f = fakeFetch(() => (done ? json({ ok: true }) : challenge()));
    setFetch(f.fn);
    const handler = vi.fn(async () => {
      done = true;
    });
    setChallengeHandler(handler);

    expect(await apiFetch("/api/x", { body: {} })).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(2);
  });

  it("partage un seul défi entre des requêtes simultanées", async () => {
    let done = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setFetch(fakeFetch(() => (done ? json({ ok: true }) : challenge())).fn);
    const handler = vi.fn(async () => {
      await gate;
      done = true;
    });
    setChallengeHandler(handler);

    const both = Promise.all([apiFetch("/api/a", { body: {} }), apiFetch("/api/b", { body: {} })]);
    await new Promise((r) => setTimeout(r, 20));
    release();
    await both;
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ne boucle pas si le défi ne suffit pas", async () => {
    const f = fakeFetch(() => challenge());
    setFetch(f.fn);
    setChallengeHandler(async () => {});
    expect(await codeOf(apiFetch("/api/x", { body: {} }))).toBe("CHALLENGE_REQUIRED");
    expect(f.calls).toHaveLength(2);
  });

  it("transmet l'échec du défi sans rejouer la requête", async () => {
  const f = fakeFetch(() => challenge());
  setFetch(f.fn);

  setChallengeHandler(async () => {
    throw new ApiError("CHALLENGE_REQUIRED", "Vérification annulée.", 403);
  });

  const err = await expectApiError(apiFetch("/api/x", { body: {} }));

  expect(err).toBeInstanceOf(ApiError);
  expect(err.code).toBe("CHALLENGE_REQUIRED");
  expect(err.message).toBe("Vérification annulée.");
  expect(err.status).toBe(403);
  expect(f.calls).toHaveLength(1);
});

  it("échoue clairement sans gestionnaire de défi", async () => {
    setFetch(fakeFetch(() => challenge()).fn);
    expect(await codeOf(apiFetch("/api/x", { body: {} }))).toBe("CHALLENGE_REQUIRED");
  });

  it("respecte skipChallenge", async () => {
    const f = fakeFetch(() => challenge());
    setFetch(f.fn);
    const handler = vi.fn(async () => {});
    setChallengeHandler(handler);
    expect(await codeOf(apiFetch("/api/x", { body: {}, skipChallenge: true }))).toBe("CHALLENGE_REQUIRED");
    expect(handler).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(1);
  });
});

describe("describeError", () => {
  it("explique une adresse privée bloquée", () => {
    const d = describeError(new ApiError("SSRF_BLOCKED", "Destination refusée.", 403));
    expect(d.title).toContain("pas accessible");
    expect(d.hint).toContain("localhost");
    expect(d.detail).toBe("Destination refusée.");
  });

  it("ajoute les dépassements de limites", () => {
    const d = describeError(
      new ApiError("LIMIT_EXCEEDED", "Le scénario dépasse les limites.", 422, { violations: ["VUs : 500 > 100", "Durée : 300s > 120s"] }),
    );
    expect(d.detail).toContain("VUs : 500 > 100 ; Durée : 300s > 120s");
  });

  it("accepte une erreur quelconque", () => {
    expect(describeError(new Error("boum")).detail).toBe("boum");
    expect(describeError("texte").title).toBe("Une erreur est survenue");
  });
});