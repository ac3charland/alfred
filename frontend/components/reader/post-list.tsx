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

export function PostList({ posts, now, variant = 'list' }: PostListProperties) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // The order `j`/`k` walk, built from the same list the rows are drawn from, so navigation can
  // never disagree with the page.
  const orderedIds = React.useMemo(() => posts.map((post) => post.id), [posts]);

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
        // hold rather than wrap, so a held key can't cycle the list forever.
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
      setSelectedId((current) => {
        if (current !== id) return current;
        const index = orderedIds.indexOf(id);
        return orderedIds[index + 1] ?? null;
      });
    },
    [orderedIds],
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
