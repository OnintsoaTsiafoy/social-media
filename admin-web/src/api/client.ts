import { clearSession, getAccessToken, refreshSession } from "./session";
import { ApiError, send, type SendOptions } from "./transport";

const EXPIRED_CODES = new Set(["token_expired", "authentication_required"]);

/**
 * Appel authentifié : ajoute le jeton d'accès et, sur un 401 de session, tente UN
 * rafraîchissement puis rejoue la requête. Si la session est perdue, l'interface est prévenue
 * (retour à la connexion) et l'erreur d'origine est relancée.
 */
export async function api<T>(path: string, options: Omit<SendOptions, "token"> = {}): Promise<T> {
  try {
    return await send<T>(path, { ...options, token: getAccessToken() });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !EXPIRED_CODES.has(error.code)) throw error;

    if (await refreshSession()) return send<T>(path, { ...options, token: getAccessToken() });
    clearSession();
    throw error;
  }
}
