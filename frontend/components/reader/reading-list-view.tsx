'use client';

import * as React from 'react';

import { EmptyState } from '@/components/atoms/empty-state';
import { PostList } from '@/components/reader/post-list';
import { ReaderBanner } from '@/components/reader/reader-banner';
import { ReaderHeader } from '@/components/reader/reader-header';
import { useNow } from '@/lib/hooks/use-now';
import { readerBanner } from '@/lib/reader/health';
import { useActiveCount, useReaderHealth, useReaderPosts } from '@/lib/stores/reader-store';

/**
 * The reading list — the Reader module's home view: the module's one banner when something is
 * wrong, the heading and health dots, the rows (already ordered and filtered to the unarchived
 * set by the store), and the resting empty state.
 *
 * `now` is read once per render, like Comms' own view — every row, the header and the banner are
 * handed the SAME instant, so a list can't render two different "now"s down its own length.
 */

interface ReadingListViewProperties {
  /**
   * The instant every row's arrival date and every health state is read against. Left off in the
   * app, where the view takes the module's ticking clock; pinned by stories and tests, since a
   * surface whose content is "how long ago" is otherwise unassertable and unsnapshottable.
   */
  now?: Date | undefined;
}

export function ReadingListView({ now: pinnedNow }: ReadingListViewProperties) {
  const posts = useReaderPosts();
  const activeCount = useActiveCount();
  const health = useReaderHealth();

  // A ticking clock, because every health state is a comparison against now: a seed frozen at
  // first paint would report a stall that ended an hour ago until something else re-rendered.
  const ticking = useNow();
  const now = pinnedNow ?? ticking;

  const banner = readerBanner(health, posts, now);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/* Above the heading, not beside it: it is not one of the two source states, and its
            fix is different from either. At most one ever renders. */}
        {banner !== null && <ReaderBanner banner={banner} now={now} />}

        <ReaderHeader
          snapshot={health}
          posts={posts}
          now={now}
          description={activeCount === 0 ? 'Nothing to read' : `${String(activeCount)} to read`}
        />
      </div>

      {posts.length === 0 ? (
        <EmptyState
          title="Nothing new to read."
          description="Newsletters from your publications land here as they arrive, summarised."
        />
      ) : (
        <PostList posts={posts} now={now} />
      )}
    </div>
  );
}
