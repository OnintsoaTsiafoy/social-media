import { useState } from "react";

import { FEED_POOL } from "@/data/overview";
import { clamp } from "@/lib/format";
import { useInterval } from "@/lib/motion";

export interface FeedEntry {
  /** Unique per arrival, so a new entry mounts (and animates in) instead of re-rendering in place. */
  key: number;
  poolIndex: number;
}

const FEED_LENGTH = 4;
const initialFeed = (): FeedEntry[] =>
  Array.from({ length: FEED_LENGTH }, (_, i) => ({ key: i, poolIndex: i }));

/**
 * Simulated live activity: the comments/min gauge drifts and a new stream item lands
 * every few seconds. Runs at provider level so the AI-supervision status line keeps
 * moving while another screen is open.
 */
export function useLiveTicker() {
  const [liveRate, setLiveRate] = useState(1284);
  const [{ seed, feed }, setFeedState] = useState({ seed: FEED_LENGTH, feed: initialFeed() });

  useInterval(() => {
    const drift = Math.round((Math.random() - 0.45) * 90);
    setLiveRate((rate) => clamp(rate + drift, 980, 1680));
  }, 1700);

  useInterval(() => {
    setFeedState((state) => ({
      seed: state.seed + 1,
      feed: [{ key: state.seed, poolIndex: state.seed % FEED_POOL.length }, ...state.feed].slice(0, FEED_LENGTH),
    }));
  }, 3400);

  return { liveRate, feed, tick: seed };
}
