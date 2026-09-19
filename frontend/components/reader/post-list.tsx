'use client';

import * as React from 'react';

import { PostRow, type PostRowVariant } from '@/components/reader/post-row';
import { readerHotkeyAction } from '@/lib/reader/hotkeys';
import type { ReaderPostListItem } from '@/lib/types';

/**
 * The rows, and the one selection they share — the body of both the reading list and the
 * archive, which differ only in which posts they hand it and which way its archive verb runs.
 *
 * Navigation and Escape live here rather than on a row, because they have to work when nothing
 * is selected at all: `j` on a freshly loaded list selects the first row. The verbs are the
 * selected ROW's, attached only while it holds the selection, so exactly one row-level listener
 * exists however long the list is.
 */

interface PostListProperties {
  /** The posts to draw, already filtered and ordered by whichever view owns them. */
  posts: ReaderPostListItem[];
  /** The instant every row's dates are read against. */
  now: Date;
  /** Which list this is; the archive reverses the archive verb. */
  variant?: PostRowVariant;
}

/** No row is leaving — the shared empty set, so the derivation below allocates nothing. */
const NO_EXITS: ReadonlySet<string> = new Set();

export function PostList({ posts, now, variant = 'list' }: PostListProperties) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  /**
   * Rows whose exit has begun, and the list they began leaving. They are still drawn — that is
   * what the collapse is for — but the keyboard must not be able to walk back onto one: the row
   * is on its way out, and its verbs would act on a post the list has already moved past.
   *
   * The flags are scoped to the exact list they were raised in, and read back only while the
   * store is still handing that same list down — so they need no pruning: a new array drops
   * them. Usually that array is the write settling, which is exactly when they should go (the
   * row committed and is gone, or rolled back and is navigable again). But ANY store dispatch
   * that rebuilds `posts` clears them — an Open stamp on another row, a focus refresh — and one
   * landing mid-collapse costs nothing: the collapse is the row's own state and finishes
   * regardless, and a second archive on the row it forgot is refused by the row's `isExiting`
   * guard rather than by this set.
   */
  const [exits, setExits] = React.useState<{
    from: readonly ReaderPostListItem[];
    ids: ReadonlySet<string>;
  }>({ from: posts, ids: NO_EXITS });
  const exitingIds = exits.from === posts ? exits.ids : NO_EXITS;

  // The order `j`/`k` walk: the drawn rows minus the ones on their way out, so navigation can
  // never disagree with the page and never lands on a row that is leaving.
  const orderedIds = React.useMemo(
    () => posts.map((post) => post.id).filter((id) => !exitingIds.has(id)),
    [posts, exitingIds],
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = readerHotkeyAction(event);
      if (action === undefined) return;

      if (action === 'deselect') {
        setSelectedId(null);
        return;
      }
      if (action !== 'next' && action !== 'previous') return;

      event.preventDefault();
      setSelectedId((current) => {
        if (orderedIds.length === 0) return current;
        const index = current === null ? -1 : orderedIds.indexOf(current);
        // A first press lands on the top row whichever direction it was; after that the ends
        // hold rather than wrap, so a held key can't cycle the list forever. A selection that
        // is not in the navigable list — nothing selected, or a row part-way out — is the same
        // case: the next press starts again from the top.
        if (index === -1) return orderedIds[0] ?? null;
        const step = action === 'next' ? 1 : -1;
        const next = Math.min(Math.max(index + step, 0), orderedIds.length - 1);
        return orderedIds[next] ?? current;
      });
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [orderedIds]);

  /**
   * A row has begun leaving. The selection moves to the row below it — the one that will occupy
   * the same place once the collapse finishes — or is dropped when it was the last. A row leaving
   * that was NOT the selected one (an archive clicked with the mouse) moves nothing.
   */
  const onExit = React.useCallback(
    (id: string) => {
      setExits((current) => ({
        from: posts,
        ids: new Set(current.from === posts ? current.ids : []).add(id),
      }));
      setSelectedId((current) => {
        if (current !== id) return current;
        const index = orderedIds.indexOf(id);
        return orderedIds[index + 1] ?? null;
      });
    },
    [orderedIds, posts],
  );

  return (
    <div className="flex flex-col gap-2">
      {posts.map((post) => (
        <PostRow
          key={post.id}
          post={post}
          now={now}
          variant={variant}
          selected={selectedId === post.id}
          onSelect={setSelectedId}
          onExit={onExit}
        />
      ))}
    </div>
  );
}
