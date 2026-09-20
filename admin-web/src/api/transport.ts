/**
 * Couche réseau de bas niveau : une requête, l'enveloppe `{ data, meta }` de l'API Express
 * dépliée, les erreurs `{ error: { code, message } }` transformées en `ApiError`. Aucune
 * notion de session ici (voir session.ts et client.ts).
 */

export class ApiError extends Error {
  readonly status: number;
  /** Code stable de l'API (`validation_failed`, `conflict`…) ou `network` / `unknown`. */
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, extra: { requestId?: string; details?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = extra.requestId;
    this.details = extra.details;
  }
}

/** En développement, le proxy de Vite relaie `/api` vers l'API (aucun CORS à configurer). */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");

type QueryValue = string | number | boolean | null | undefined;

export interface SendOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  token?: string | null;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const entries = Object.entries(query ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  const search = new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString();
  return `${API_BASE_URL}${path}${search ? `?${search}` : ""}`;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
}

export async function send<T>(path: string, { method = "GET", body, query, token, signal }: SendOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal,
      headers: {
        Accept: "application/json",
        "X-Device-Name": "Console web d'administration",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // Une requête annulée volontairement n'est pas une panne réseau.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network", "Serveur injoignable.");
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const failure = (payload as ErrorEnvelope | undefined)?.error;
    throw new ApiError(response.status, failure?.code ?? "unknown", failure?.message ?? "Erreur inconnue.", {
      requestId: failure?.requestId,
      details: failure?.details,
    });
  }
  return (payload as { data: T }).data;
}
