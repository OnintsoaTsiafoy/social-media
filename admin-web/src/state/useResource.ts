import { useCallback, useEffect, useRef, useState } from "react";

export interface Resource<T> {
  /** Dernières données reçues ; conservées pendant un rechargement (pas de clignotement). */
  data: T | null;
  /** Dernière erreur ; effacée au prochain succès. Un rafraîchissement silencieux ne masque pas `data`. */
  error: unknown;
  /** Vrai pendant un chargement visible (premier chargement, changement de filtre, `reload`). */
  loading: boolean;
  /** Relance un chargement visible. */
  reload: () => void;
  /** Remplace les données localement (résultat d'une action), sans nouvel appel. */
  update: (updater: (current: T) => T) => void;
}

interface Options {
  /** Rafraîchit en silence à cet intervalle (ms). */
  refreshMs?: number;
  enabled?: boolean;
}

/**
 * Lit une ressource de l'API.
 *
 * `key` résume les paramètres de la requête : quand il change, une nouvelle requête part et la
 * précédente est annulée — une réponse tardive ne peut jamais écraser une plus récente. Le
 * chargeur, lui, est lu via une référence : pas besoin de le mémoïser.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, key: string, options: Options = {}): Resource<T> {
  const { refreshMs, enabled = true } = options;
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({
    data: null,
    error: null,
    loading: enabled,
  });
  const [version, setVersion] = useState(0);
  const loader = useRef(load);

  // Déclaré avant les effets de chargement : React les exécute dans l'ordre de déclaration.
  useEffect(() => {
    loader.current = load;
  });

  const run = useCallback(async (silent: boolean, signal: AbortSignal) => {
    if (!silent) setState((current) => ({ ...current, loading: true }));
    try {
      const data = await loader.current(signal);
      if (!signal.aborted) setState({ data, error: null, loading: false });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setState((current) => ({ ...current, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void run(false, controller.signal);
    return () => controller.abort();
  }, [key, version, enabled, run]);

  useEffect(() => {
    if (!enabled || !refreshMs) return;
    let controller: AbortController | null = null;
    const id = window.setInterval(() => {
      controller?.abort();
      controller = new AbortController();
      void run(true, controller.signal);
    }, refreshMs);
    return () => {
      window.clearInterval(id);
      controller?.abort();
    };
  }, [key, refreshMs, enabled, run]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const update = useCallback(
    (updater: (current: T) => T) =>
      setState((current) => (current.data === null ? current : { ...current, data: updater(current.data) })),
    [],
  );

  return { data: state.data, error: state.error, loading: state.loading, reload, update };
}
