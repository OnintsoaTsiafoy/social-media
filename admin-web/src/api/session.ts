import { ApiError, send } from "./transport";
import type { AdminProfile } from "./types";

/**
 * Jetons de la console. Le jeton d'accès (15 min) ne vit qu'en mémoire ; le jeton de
 * rafraîchissement est gardé dans `sessionStorage` : il survit à un rechargement de la page
 * mais pas à la fermeture de l'onglet. L'API n'offre pas de cookie httpOnly — c'est le moins
 * exposé des deux emplacements dont dispose une application web.
 *
 * Le rafraîchissement est « à usage unique » côté serveur (rotation) : deux appels
 * simultanés révoqueraient toute la session. Un seul rafraîchissement est donc en vol à la fois.
 */

const REFRESH_KEY = "pulse.refreshToken";

let accessToken: string | null = null;
let refreshToken: string | null = readRefreshToken();
let refreshing: Promise<boolean> | null = null;
const signedOutListeners = new Set<() => void>();

function readRefreshToken(): string | null {
  try {
    return window.sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefreshToken(value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(REFRESH_KEY);
    else window.sessionStorage.setItem(REFRESH_KEY, value);
  } catch {
    // Sans stockage, la session ne survit simplement pas à un rechargement.
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function hasStoredSession(): boolean {
  return refreshToken !== null;
}

function storeTokens(tokens: { accessToken: string; refreshToken: string }): void {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  writeRefreshToken(tokens.refreshToken);
}

/** Efface la session locale ; `notify` prévient l'interface (retour à l'écran de connexion). */
export function clearSession(notify = true): void {
  accessToken = null;
  refreshToken = null;
  writeRefreshToken(null);
  if (notify) signedOutListeners.forEach((listener) => listener());
}

export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AdminProfile;
}

export async function login(email: string, password: string): Promise<AdminProfile> {
  const data = await send<AuthResponse>("/auth/login", { method: "POST", body: { email, password } });
  storeTokens(data);
  return data.user;
}

/**
 * Obtient un nouveau jeton d'accès. `false` = la session est perdue (refus du serveur) ;
 * une panne réseau, elle, se propage : on ne déconnecte pas quelqu'un parce que le Wi-Fi coupe.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  if (!refreshToken) return Promise.resolve(false);

  const current = refreshToken;
  refreshing = (async () => {
    try {
      const data = await send<AuthResponse>("/auth/refresh", { method: "POST", body: { refreshToken: current } });
      storeTokens(data);
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        clearSession(false);
        return false;
      }
      throw error;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function logout(): Promise<void> {
  const token = accessToken;
  clearSession(false);
  if (!token) return;
  try {
    await send("/auth/logout", { method: "POST", token });
  } catch {
    // La session locale est déjà effacée ; le jeton expirera de lui-même côté serveur.
  }
}
