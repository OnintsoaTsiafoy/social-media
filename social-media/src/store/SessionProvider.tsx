import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, auth, brandsApi, notificationsApi } from '@/data/api';
import { clearSessionTokens, readToken, saveRefreshToken, saveToken } from '@/lib/secureStorage';
import { unregisterForPushNotifications } from '@/lib/pushNotifications';
import type { Brand, User } from '@/types';

export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn';

type SessionValue = {
  status: SessionStatus;
  user: User | undefined;
  brand: Brand | undefined;
  unreadCount: number;
  /** Set when session restore failed for a reason the user can act on. */
  restoreError: string | undefined;
  signIn: (token: string, user: User, refreshToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  restore: () => Promise<void>;
  setBrand: (brand: Brand) => void;
  setUser: (user: User) => void;
  refreshUnreadCount: () => Promise<void>;
  markAllNotificationsRead: () => void;
};

const SessionContext = createContext<SessionValue | undefined>(undefined);

/** How long the splash screen waits before offering a retry. */
const RESTORE_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ApiError('server', 'Le délai de connexion est dépassé. Réessayez.')),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('restoring');
  const [user, setUserState] = useState<User | undefined>(undefined);
  const [brand, setBrandState] = useState<Brand | undefined>(undefined);
  const [unreadCount, setUnreadCount] = useState(0);
  const [restoreError, setRestoreError] = useState<string | undefined>(undefined);

  /**
   * Splash sequence: read the stored token, validate it against `/auth/me`,
   * then load the profile, active brand and unread count. An invalid token is
   * deleted so the user is never stuck in a broken session.
   */
  const restore = useCallback(async () => {
    setStatus('restoring');
    setRestoreError(undefined);

    try {
      const token = await readToken();
      if (!token) {
        setStatus('signedOut');
        return;
      }

      const result = await withTimeout(auth.me(), RESTORE_TIMEOUT_MS);
      setUserState(result.user);
      setBrandState(result.brand);
      setUnreadCount(result.unreadCount);
      setStatus('signedIn');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthorized') {
        await clearSessionTokens();
        setStatus('signedOut');
        return;
      }
      setRestoreError(
        error instanceof ApiError
          ? error.message
          : 'Impossible de contacter le serveur. Vérifiez votre connexion.'
      );
      setStatus('restoring');
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const signIn = useCallback(async (token: string, signedInUser: User, refreshToken: string) => {
    await saveToken(token);
    await saveRefreshToken(refreshToken);
    setUserState(signedInUser);
    setStatus('signedIn');

    // Non-blocking: a failure here must not prevent entering the app.
    void brandsApi.getActive().then(setBrandState).catch(() => undefined);
    void notificationsApi.unreadCount().then(setUnreadCount).catch(() => undefined);
  }, []);

  const signOut = useCallback(async () => {
    // Avant tout : un compte différent connecté ensuite sur cet appareil ne
    // doit jamais recevoir les notifications restées en attente pour cet
    // utilisateur (voir src/lib/pushNotifications.ts).
    await unregisterForPushNotifications();
    try {
      await auth.logout();
    } catch {
      // Local revocation still protects the device when it is offline.
    }
    await clearSessionTokens();
    setUserState(undefined);
    setBrandState(undefined);
    setUnreadCount(0);
    setStatus('signedOut');
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    try {
      setUnreadCount(await notificationsApi.unreadCount());
    } catch {
      // Leave the previous count in place.
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      brand,
      unreadCount,
      restoreError,
      signIn,
      signOut,
      restore,
      setBrand: setBrandState,
      setUser: setUserState,
      refreshUnreadCount,
      markAllNotificationsRead: () => setUnreadCount(0),
    }),
    [status, user, brand, unreadCount, restoreError, signIn, signOut, restore, refreshUnreadCount]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>.');
  return context;
}
