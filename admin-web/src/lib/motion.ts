import { useCallback, useEffect, useRef, useState } from "react";

const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

/**
 * Eased 0 → 1 progress used for the count-up on the overview figures. Runs on mount;
 * `replay(duration)` restarts it (the range selector does).
 */
export function useCountUp(initialDuration = 1200): readonly [number, (duration?: number) => void] {
  const [progress, setProgress] = useState(0);
  const frame = useRef(0);

  const replay = useCallback((duration = initialDuration) => {
    cancelAnimationFrame(frame.current);
    const start = performance.now();
    setProgress(0);
    const step = (now: number) => {
      const raw = Math.min(1, (now - start) / duration);
      setProgress(easeOutCubic(raw));
      if (raw < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [initialDuration]);

  useEffect(() => {
    replay();
    return () => cancelAnimationFrame(frame.current);
  }, [replay]);

  return [progress, replay] as const;
}

/**
 * Follows `target` with an eased transition. A change of target mid-flight restarts
 * from the values currently on screen, so the line never jumps.
 */
export function useTweenedArray(target: number[], duration = 560): number[] {
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    if (target.every((value, i) => value === from[i])) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const eased = easeOutCubic(Math.min(1, (now - start) / duration));
      const next = target.map((value, i) => {
        const origin = from[i] ?? value;
        return origin + (value - origin) * eased;
      });
      current.current = next;
      setShown(next);
      if (eased < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return shown;
}

/** Calls `callback` every `delayMs` (always the latest closure) until unmount. */
export function useInterval(callback: () => void, delayMs: number): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    const id = window.setInterval(() => saved.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}
