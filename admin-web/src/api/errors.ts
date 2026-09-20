import type { Translate } from "@/i18n";

import { ApiError } from "./transport";

/**
 * Message affichable pour une erreur. Comme sur mobile, aucun message technique n'atteint
 * l'écran : le code stable de l'API sert de clé de traduction, jamais le texte du serveur.
 */
export function toUserMessage(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t("error.unknown");

  // Le même code `token_expired` désigne deux choses : la session de l'administrateur
  // (401) et le jeton Meta d'une page (409, au moment d'envoyer une réponse).
  if (error.code === "token_expired" && error.status === 409) return t("error.social_token_expired");

  switch (error.code) {
    case "network":
      return t("error.network");
    case "invalid_credentials":
      return t("error.invalid_credentials");
    case "account_disabled":
      return t("error.account_disabled");
    case "authentication_required":
    case "token_expired":
      return t("error.authentication_required");
    case "forbidden":
      return t("error.forbidden");
    case "not_found":
      return t("error.not_found");
    case "conflict":
      return t("error.conflict");
    case "validation_failed":
      return t("error.validation_failed");
    case "rate_limited":
      return t("error.rate_limited");
    case "ai_unavailable":
      return t("error.ai_unavailable");
    case "provider_unavailable":
      return t("error.provider_unavailable");
    default:
      return t("error.unknown");
  }
}
