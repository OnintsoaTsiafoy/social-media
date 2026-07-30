import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { MediaAsset, SocialNetwork } from '@/types';

export type ComposerDraft = {
  brandId: string;
  text: string;
  hashtags: string[];
  media: MediaAsset | null;
  networks: SocialNetwork[];
  perNetworkEnabled: boolean;
  perNetwork: Partial<Record<SocialNetwork, { text: string; hashtags: string[] }>>;
};

const emptyDraft: ComposerDraft = {
  brandId: '',
  text: '',
  hashtags: [],
  media: null,
  networks: [],
  perNetworkEnabled: false,
  perNetwork: {},
};

type ComposerValue = {
  draft: ComposerDraft;
  /** True once the draft differs from what was loaded. */
  dirty: boolean;
  patch: (changes: Partial<ComposerDraft>) => void;
  reset: (next?: Partial<ComposerDraft>) => void;
  /** Marks the current state as saved without clearing it. */
  markClean: () => void;
};

const ComposerContext = createContext<ComposerValue | undefined>(undefined);

/**
 * Holds the publication being composed.
 *
 * It lives above the router so the media picker and hashtag generator can be
 * separate routes (as the design shows) and still write back into the same
 * draft - without passing large objects through URL params.
 */
export function ComposerProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ComposerDraft>(emptyDraft);
  const [dirty, setDirty] = useState(false);

  const patch = useCallback((changes: Partial<ComposerDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setDirty(true);
  }, []);

  const reset = useCallback((next?: Partial<ComposerDraft>) => {
    setDraft({ ...emptyDraft, ...next });
    setDirty(false);
  }, []);

  const value = useMemo<ComposerValue>(
    () => ({ draft, dirty, patch, reset, markClean: () => setDirty(false) }),
    [draft, dirty, patch, reset]
  );

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

export function useComposer(): ComposerValue {
  const context = useContext(ComposerContext);
  if (!context) throw new Error('useComposer must be used inside <ComposerProvider>.');
  return context;
}
