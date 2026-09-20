import { useEffect, useState } from "react";

/**
 * Ce que Facebook (via graph-api) renvoie à la console après l'autorisation, dans le fragment de
 * l'adresse : `#/pages?status=select&selection=<id>` ou `#/pages?status=error&reason=<code>`.
 * Jamais de jeton dans cette adresse : seulement un état et l'identifiant d'une sélection.
 */
export type OAuthReturn =
  | { kind: "select"; selectionId: string }
  | { kind: "error"; reason: string };

const REASONS = ["permission_denied", "incompatible_account", "provider_error"] as const;

export function parseOAuthReturn(hash: string): OAuthReturn | null {
  const query = hash.split("?")[1];
  if (!query) return null;

  const params = new URLSearchParams(query);
  const status = params.get("status");
  if (status === "select") {
    const selectionId = params.get("selection");
    return selectionId ? { kind: "select", selectionId } : { kind: "error", reason: "unknown" };
  }
  if (status === "error") {
    const reason = params.get("reason") ?? "";
    return { kind: "error", reason: REASONS.find((known) => known === reason) ?? "unknown" };
  }
  return null;
}

/** Retire l'état de l'adresse : recharger la page ne rouvre pas la sélection. */
export function clearOAuthReturn(): void {
  window.history.replaceState(null, "", "#/pages");
}

/**
 * Lit le retour de Facebook une seule fois, à l'ouverture de l'écran des pages, puis nettoie
 * l'adresse. Si l'administrateur devait d'abord se reconnecter, le fragment est resté intact.
 */
export function useOAuthReturn(): OAuthReturn | null {
  const [returned] = useState(() => parseOAuthReturn(window.location.hash));
  useEffect(() => {
    if (returned) clearOAuthReturn();
  }, [returned]);
  return returned;
}
