'use client';

import { BookOpen } from 'lucide-react';
import * as React from 'react';

import { EmptyState } from '@/components/atoms/empty-state';
import { ViewHeading } from '@/components/atoms/view-heading';
import { PostRow } from '@/components/reader/post-row';
import { useActiveCount, useReaderPosts } from '@/lib/stores/reader-store';

/**
 * The reading list — the Reader module's home view: the heading, the rows (already
 * ordered and filtered to the unarchived set by the store), and the resting empty state.
 *
 * `now` is read once per render, like Comms' own view — every row is handed the SAME instant,
 * so a list can't render two different "now"s down its own length.
 */

interface ReadingListViewProperties {
  /**
   * The instant every row's arrival date is read against. Left off in the app, where the view
   * ticks its own clock; pinned by stories and tests, since a surface whose every date is read
   * against today is otherwise unassertable and unsnapshottable.
   */
  now?: Date | undefined;
}

export function ReadingListView({ now: pinnedNow }: ReadingListViewProperties) {
  const posts = useReaderPosts();
  const activeCount = useActiveCount();
  const now = pinnedNow ?? new Date();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ViewHeading
        icon={BookOpen}
        title="Reader"
        description={activeCount === 0 ? 'Nothing to read' : `${String(activeCount)} to read`}
        accent="reader"
      />

      {posts.length === 0 ? (
        <EmptyState
          title="Nothing new to read."
          description="Newsletters from your publications land here as they arrive, summarised."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {posts.map((post) => (
            <PostRow key={post.id} post={post} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
