import { beforeEach, describe, expect, it, vi } from "vitest";

import { translate, type Translate } from "@/i18n";
import { mockApi } from "@/test/mockApi";

import { api } from "./client";
import { toUserMessage } from "./errors";
import { adminApi } from "./endpoints";
import { clearSession, getAccessToken, hasStoredSession, login, logout, onSignedOut, refreshSession } from "./session";
import { ApiError, send } from "./transport";

const t: Translate = (key, params) => translate("fr", key, params);

beforeEach(() => clearSession(false));

describe("send", () => {
  it("déplie l'enveloppe { data, meta }", async () => {
    mockApi({ "GET /admin/summary": () => ({ data: { pages: { all: 3 } } }) });
    await expect(send("/admin/summary")).resolves.toEqual({ pages: { all: 3 } });
  });

  it("construit la chaîne de requête en ignorant les valeurs vides", async () => {
    const { calls } = mockApi();
    await adminApi.trend({ metric: "engagement", period: "30d", sentiment: "all", network: "all", pageId: undefined });
    expect(calls[0]?.query).toEqual({ metric: "engagement", period: "30d", sentiment: "all", network: "all" });
  });

  it("ajoute le jeton et le corps JSON quand il y en a", async () => {
    const { fetchMock } = mockApi({ "POST /admin/settings/keywords": () => ({ status: 201, data: { keywords: [] } }) });
    await send("/admin/settings/keywords", { method: "POST", body: { word: "x" }, token: "jeton" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jeton");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"word":"x"}');
  });

  it("transforme une erreur de l'API en ApiError avec son code stable", async () => {
    mockApi({ "GET /admin/users": () => ({ status: 409, error: { code: "conflict", message: "Déjà traité" } }) });
    const error = await send("/admin/users").catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "conflict", requestId: "req-test" });
  });

  it("distingue une panne réseau d'une erreur de l'API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(send("/admin/summary")).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("laisse passer l'annulation d'une requête sans la prendre pour une panne", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("annulée", "AbortError")));
    await expect(send("/admin/summary")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("répond undefined à un 204", async () => {
    mockApi({ "POST /auth/logout": () => ({ status: 204 }) });
    await expect(send("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});

describe("session", () => {
  it("garde le jeton d'accès en mémoire et le jeton de rafraîchissement dans l'onglet", async () => {
    mockApi();
    await login("admin@hootly.app", "secret");
    expect(getAccessToken()).toBe("access-1");
    expect(window.sessionStorage.getItem("pulse.refreshToken")).toBe("refresh-1");
    expect(window.localStorage.length).toBe(0);
    expect(hasStoredSession()).toBe(true);
  });

  it("efface tout à la déconnexion, même si le serveur ne répond pas", async () => {
    mockApi({ "POST /auth/logout": () => ({ status: 500, error: { code: "internal_error" } }) });
    await login("admin@hootly.app", "secret");
    await logout();
    expect(getAccessToken()).toBeNull();
    expect(hasStoredSession()).toBe(false);
    expect(window.sessionStorage.getItem("pulse.refreshToken")).toBeNull();
  });

  it("ne lance qu'un rafraîchissement à la fois : le jeton est à usage unique côté serveur", async () => {
    const mock = mockApi();
    await login("admin@hootly.app", "secret");
    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(results).toEqual([true, true, true]);
    expect(mock.callsTo("POST", "/auth/refresh")).toHaveLength(1);
    expect(getAccessToken()).toBe("access-2");
  });

  it("efface la session quand le serveur refuse le rafraîchissement", async () => {
    mockApi({ "POST /auth/refresh": () => ({ status: 401, error: { code: "authentication_required" } }) });
    await login("admin@hootly.app", "secret");
    await expect(refreshSession()).resolves.toBe(false);
    expect(hasStoredSession()).toBe(false);
  });

  it("garde la session quand le rafraîchissement échoue à cause du réseau", async () => {
    mockApi();
    await login("admin@hootly.app", "secret");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(refreshSession()).rejects.toMatchObject({ code: "network" });
    expect(hasStoredSession()).toBe(true);
  });
});

describe("api (appel authentifié)", () => {
  it("rafraîchit une fois sur un jeton expiré, puis rejoue la requête", async () => {
    let attempts = 0;
    const mock = mockApi({
      "GET /admin/summary": () =>
        ++attempts === 1 ? { status: 401, error: { code: "token_expired" } } : { data: { ok: true } },
    });
    await login("admin@hootly.app", "secret");

    await expect(api("/admin/summary")).resolves.toEqual({ ok: true });
    expect(mock.callsTo("POST", "/auth/refresh")).toHaveLength(1);
    expect(mock.callsTo("GET", "/admin/summary")).toHaveLength(2);
  });

  it("prévient l'interface quand la session est perdue", async () => {
    mockApi({
      "GET /admin/summary": () => ({ status: 401, error: { code: "token_expired" } }),
      "POST /auth/refresh": () => ({ status: 401, error: { code: "authentication_required" } }),
    });
    await login("admin@hootly.app", "secret");
    const signedOut = vi.fn();
    const stop = onSignedOut(signedOut);

    await expect(api("/admin/summary")).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toHaveBeenCalledOnce();
    stop();
  });

  it("ne tente pas de rafraîchir sur un refus de droits ou une erreur serveur", async () => {
    const mock = mockApi({ "GET /admin/users": () => ({ status: 403, error: { code: "forbidden" } }) });
    await login("admin@hootly.app", "secret");
    await expect(api("/admin/users")).rejects.toMatchObject({ code: "forbidden" });
    expect(mock.callsTo("POST", "/auth/refresh")).toHaveLength(0);
  });
});

describe("toUserMessage", () => {
  const failure = (status: number, code: string) => new ApiError(status, code, "message technique du serveur");

  it("traduit le code, jamais le texte du serveur", () => {
    expect(toUserMessage(failure(401, "invalid_credentials"), t)).toBe("Adresse e-mail ou mot de passe incorrect.");
    expect(toUserMessage(failure(403, "forbidden"), t)).toBe("Vous n'avez pas les droits pour cette action.");
    expect(toUserMessage(failure(429, "rate_limited"), t)).toContain("Trop de tentatives");
    expect(toUserMessage(failure(0, "network"), t)).toContain("Impossible de joindre le serveur");
    expect(toUserMessage(failure(400, "validation_failed"), t)).not.toContain("technique");
  });

  it("distingue le jeton de session expiré du jeton Meta expiré", () => {
    expect(toUserMessage(failure(401, "token_expired"), t)).toContain("session a expiré");
    expect(toUserMessage(failure(409, "token_expired"), t)).toContain("jeton de la page");
  });

  it("retombe sur un message générique pour une erreur inconnue", () => {
    expect(toUserMessage(new Error("boom"), t)).toBe("Une erreur est survenue. Réessayez.");
    expect(toUserMessage(failure(500, "internal_error"), t)).toBe("Une erreur est survenue. Réessayez.");
  });

  it("parle anglais quand la langue le demande", () => {
    expect(toUserMessage(failure(0, "network"), (key, params) => translate("en", key, params))).toContain("Could not reach the server");
  });
});
