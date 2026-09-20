import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { adminApi } from "@/api/endpoints";
import { hasStoredSession, login, logout, onSignedOut, refreshSession } from "@/api/session";
import type { AdminProfile } from "@/api/types";

type AuthState =
  | { status: "restoring" }
  | { status: "signedOut" }
  | { status: "signedIn"; profile: AdminProfile };

interface AuthValue {
  state: AuthState;
  /** Ouvre une session ; lève l'`ApiError` (identifiants, compte non administrateur…). */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Session de la console. Au chargement, un jeton de rafraîchissement conservé dans l'onglet
 * rouvre la session sans redemander le mot de passe ; sinon on tombe sur l'écran de connexion.
 * Le rôle est vérifié par `GET /admin/session` (403 pour un compte non administrateur).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => (hasStoredSession() ? { status: "restoring" } : { status: "signedOut" }));

  useEffect(() => {
    if (state.status !== "restoring") return;
    let cancelled = false;

    (async () => {
      try {
        if (!(await refreshSession())) {
          if (!cancelled) setState({ status: "signedOut" });
          return;
        }
        const session = await adminApi.session();
        if (!cancelled) setState({ status: "signedIn", profile: session.user });
      } catch {
        // Serveur injoignable ou accès refusé : retour à la connexion, qui explique l'erreur.
        if (!cancelled) setState({ status: "signedOut" });
      }
    })();

    return () => {
      cancelled = true;
    };
    // Une seule tentative de reprise, au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session perdue en cours de route (refresh refusé) : retour immédiat à la connexion.
  useEffect(() => onSignedOut(() => setState({ status: "signedOut" })), []);

  const signIn = useCallback(async (email: string, password: string) => {
    const profile = await login(email, password);
    try {
      await adminApi.session();
    } catch (error) {
      // Compte valide mais pas administrateur : on ne garde pas une session inutile.
      await logout();
      throw error;
    }
    setState({ status: "signedIn", profile });
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setState({ status: "signedOut" });
  }, []);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
