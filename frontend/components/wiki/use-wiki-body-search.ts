'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';
import type { WikiSearchHit } from '@/lib/types';

/** How long typing must pause before the body search goes out. */
export const WIKI_BODY_SEARCH_DEBOUNCE_MS = 250;

/** The shortest query the body search runs for — the route's own floor. */
export const WIKI_BODY_SEARCH_MIN_LENGTH = 2;

/** Where the "In page text" group is for the query on screen. */
export type WikiBodySearchState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error' }
  | { status: 'ready'; hits: WikiSearchHit[] };

type Answer = { query: string } & (
  | { status: 'error' }
  | { status: 'ready'; hits: WikiSearchHit[] }
);

/**
 * The body search for `query`: Postgres full-text search through `GET /api/wiki/search`, fired
 * once typing pauses for 250ms and only for a query of at least two characters.
 *
 * It is a read the store has no business holding — per keystroke, never seeded, never shared —
 * so the view asks the API for it directly, the way the Comms dialogs do. An answer is kept with
 * the query it answers and shown only while that is still the query on screen, so a slow answer
 * for an earlier query can never stand in for the current one; until the current one answers,
 * the group is pending.
 */
export function useWikiBodySearch(query: string): WikiBodySearchState {
  const term = query.trim();
  const [answer, setAnswer] = React.useState<Answer | undefined>();
  const latestRef = React.useRef(term);

  const search = useDebouncedCallback((next: string) => {
    void api.searchWikiBodies(next).then(
      (hits) => {
        if (latestRef.current === next) setAnswer({ query: next, status: 'ready', hits });
      },
      () => {
        if (latestRef.current === next) setAnswer({ query: next, status: 'error' });
      },
    );
  }, WIKI_BODY_SEARCH_DEBOUNCE_MS);

  // The network is the external system this keeps in step with the query on screen.
  React.useEffect(() => {
    latestRef.current = term;
    if (term.length >= WIKI_BODY_SEARCH_MIN_LENGTH) search(term);
  }, [term, search]);

  if (term.length < WIKI_BODY_SEARCH_MIN_LENGTH) return { status: 'idle' };
  if (answer?.query !== term) return { status: 'pending' };
  return answer.status === 'ready' ? { status: 'ready', hits: answer.hits } : { status: 'error' };
}
