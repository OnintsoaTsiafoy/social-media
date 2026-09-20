import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_RULES,
  DEFAULT_THRESHOLD,
  QUEUE_ITEMS,
  type QueueItem,
  type RuleKey,
} from "@/data/supervision";

/** Time the "publishing…" state stays up before the reply counts as sent. */
const PUBLISH_MS = 1150;

/**
 * AI-supervision state: the review queue, the autonomy threshold and the escalation
 * rules. Every resolved draft (approved, rejected, escalated) counts as human feedback.
 */
export function useSupervision(say: (message: string) => void) {
  const [autoReply, setAutoReply] = useState(true);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [removed, setRemoved] = useState<string[]>([]);
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [taught, setTaught] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const queue = useMemo(() => QUEUE_ITEMS.filter((item) => !removed.includes(item.id)), [removed]);

  const resolve = useCallback((id: string) => {
    setRemoved((ids) => [...ids, id]);
    setFeedbackFor(null);
    setTaught((count) => count + 1);
    setSending((map) => ({ ...map, [id]: false }));
  }, []);

  const approve = useCallback(
    (item: QueueItem) => {
      setSending((map) => ({ ...map, [item.id]: true }));
      timers.current.push(
        window.setTimeout(() => {
          resolve(item.id);
          say(`Reply published on ${item.page}`);
        }, PUBLISH_MS),
      );
    },
    [resolve, say],
  );

  const askRejectReason = useCallback((id: string) => setFeedbackFor(id), []);

  const reject = useCallback(
    (id: string, reason: string) => {
      resolve(id);
      say(`“${reason}” recorded · model updated`);
    },
    [resolve, say],
  );

  const escalate = useCallback(
    (id: string) => {
      resolve(id);
      say("Escalated to a senior community manager");
    },
    [resolve, say],
  );

  const editDraft = useCallback(() => say("Draft opened in the composer"), [say]);

  const toggleAutoReply = useCallback(() => {
    setAutoReply((on) => !on);
    say(autoReply ? "Auto-reply paused platform-wide" : "Auto-reply resumed");
  }, [autoReply, say]);

  const toggleRule = useCallback(
    (key: RuleKey) => setRules((current) => ({ ...current, [key]: !current[key] })),
    [],
  );

  return {
    autoReply,
    threshold,
    rules,
    queue,
    sending,
    feedbackFor,
    taught,
    setThreshold,
    toggleAutoReply,
    toggleRule,
    approve,
    askRejectReason,
    reject,
    escalate,
    editDraft,
  };
}
