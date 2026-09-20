import { vi } from "vitest";

import * as fixtures from "./fixtures";

export interface RecordedCall {
  method: string;
  /** Chemin sans le préfixe /api/v1, par exemple `/admin/overview`. */
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export interface MockReply {
  status?: number;
  data?: unknown;
  /** Réponse d'erreur au format de l'API. */
  error?: { code: string; message?: string };
}

type Handler = (call: RecordedCall) => MockReply | Promise<MockReply>;

/** Réponses par défaut : une plateforme saine, l'administrateur `PROFILE` connecté. */
function defaults(): Record<string, Handler> {
  return {
    "POST /auth/login": () => ({ data: { accessToken: "access-1", refreshToken: "refresh-1", tokenType: "Bearer", expiresIn: 900, user: fixtures.PROFILE } }),
    "POST /auth/refresh": () => ({ data: { accessToken: "access-2", refreshToken: "refresh-2", tokenType: "Bearer", expiresIn: 900, user: fixtures.PROFILE } }),
    "POST /auth/logout": () => ({ status: 204 }),
    "GET /admin/session": () => ({ data: fixtures.SESSION }),
    "GET /admin/summary": () => ({ data: fixtures.SUMMARY }),
    "GET /admin/overview": () => ({ data: fixtures.OVERVIEW }),
    "GET /admin/live": () => ({ data: fixtures.LIVE }),
    "GET /admin/supervision": () => ({ data: structuredClone(fixtures.SUPERVISION) }),
    "GET /admin/analytics/trend": () => ({ data: fixtures.TREND }),
    "GET /admin/analytics/pages": () => ({ data: fixtures.PAGE_PERFORMANCE }),
    "GET /admin/users": () => ({ data: fixtures.USER_LIST }),
    "GET /admin/pages": () => ({ data: fixtures.PAGES }),
    "GET /admin/settings": () => ({ data: structuredClone(fixtures.SETTINGS) }),
    "GET /admin/audit": () => ({ data: fixtures.AUDIT }),
  };
}

/**
 * Remplace `fetch` par une table de routes. `overrides` ajoute ou remplace des routes, sous la
 * forme `"METHODE /chemin"`. Une route inconnue répond 404 `not_found`, comme l'API.
 */
export function mockApi(overrides: Record<string, Handler> = {}) {
  const handlers = { ...defaults(), ...overrides };
  const calls: RecordedCall[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const call: RecordedCall = {
      method,
      path,
      query: Object.fromEntries(url.searchParams),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const handler = handlers[`${method} ${path}`];
    const reply: MockReply = handler
      ? await handler(call)
      : { status: 404, error: { code: "not_found", message: "Route inconnue." } };

    if (reply.status === 204) return new Response(null, { status: 204 });
    if (reply.error) {
      return new Response(JSON.stringify({ error: { message: "Erreur", requestId: "req-test", ...reply.error } }), {
        status: reply.status ?? 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: reply.data, meta: { requestId: "req-test" } }), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    calls,
    fetchMock,
    /** Appels reçus pour une route, du plus ancien au plus récent. */
    callsTo: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path),
  };
}
