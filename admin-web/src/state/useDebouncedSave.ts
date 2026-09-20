import { useCallback, useEffect, useRef } from "react";

/**
 * Regroupe des modifications rapprochées (curseur, boutons +/−) en un seul enregistrement.
 * Une modification en attente est enregistrée tout de suite si l'écran est quitté : changer
 * d'écran juste après avoir bougé le curseur ne doit pas perdre le réglage.
 */
export function useDebouncedSave<T>(save: (value: T) => void, merge: (pending: T, next: T) => T, delayMs = 500) {
  const saveRef = useRef(save);
  const mergeRef = useRef(merge);
  useEffect(() => {
    saveRef.current = save;
    mergeRef.current = merge;
  });

  const timer = useRef(0);
  const pending = useRef<{ value: T } | null>(null);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const waiting = pending.current;
    pending.current = null;
    if (waiting) saveRef.current(waiting.value);
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value: pending.current ? mergeRef.current(pending.current.value, value) : value };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  useEffect(() => flush, [flush]);
  return schedule;
}
