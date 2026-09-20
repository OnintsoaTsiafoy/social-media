import { useCallback, useEffect, useRef, useState } from "react";

const TOAST_MS = 2600;

export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef(0);

  const say = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, say };
}
