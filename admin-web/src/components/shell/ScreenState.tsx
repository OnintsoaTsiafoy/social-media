import type { ReactNode } from "react";

import { ErrorState } from "@/components/ErrorState";

import { ScreenSkeleton } from "./ScreenSkeleton";

interface ScreenStateProps {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Les données sont là : on affiche l'écran, même pendant un rechargement. */
  ready: boolean;
  children: ReactNode;
}

/** Squelette pendant le premier chargement, encart d'erreur avec « Réessayer », sinon l'écran. */
export function ScreenState({ loading, error, onRetry, ready, children }: ScreenStateProps) {
  if (ready) return <>{children}</>;
  if (error && !loading) return <ErrorState error={error} onRetry={onRetry} />;
  return <ScreenSkeleton />;
}
