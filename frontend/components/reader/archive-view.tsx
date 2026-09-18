'use client';

import { Archive } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { ViewHeading } from '@/components/atoms/view-heading';
import { PostList } from '@/components/reader/post-list';
import { useNow } from '@/lib/hooks/use-now';
import { useArchiveStatus, useArchivedPosts, useReaderActions } from '@/lib/stores/reader-store';

/**
 * The archive segment — everything the owner has finished with, newest arrival first, with the
 * same rows, the same overview and the same keyboard as the reading list. The one difference is
 * the verb in Archive's slot, which puts a post back.
 *
 * Unlike the reading list, the archive is not seeded by the shell: it is unbounded — every post
 * ever skimmed — while the app's fetch-everything seed assumes a bounded table. So it reads its
 * own scope on first visit and folds the answer into the store's one post list, which is what
 * keeps a post archived in this session from arriving a second time as a separate row.
 */

interface ArchiveViewProperties {
  /**
   * The instant every row's arrival date is read against. Left off in the app, where the view
   * takes the module's ticking clock; pinned by stories and tests, as `ReadingListView`'s own
   * `now` is — a surface whose content is "how long ago" is otherwise unassertable.
   */
  now?: Date | undefined;
}

export function ArchiveView({ now: pinnedNow }: ArchiveViewProperties) {
  const posts = useArchivedPosts();
  const { status, full } = useArchiveStatus();
  const { loadArchive } = useReaderActions();

  const ticking = useNow();
  const now = pinnedNow ?? ticking;

  // The read is the store's to make once; this only says "the archive is being looked at now".
  React.useEffect(() => {
    loadArchive();
  }, [loadArchive]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ViewHeading
        icon={Archive}
        title="Archive"
        description="Everything you've skimmed and put away. Unarchive to bring one back."
        accent="reader"
      />

      {posts.length > 0 && <PostList posts={posts} now={now} variant="archive" />}

      {/* Only once the read has landed: before that, an empty list means "not here yet", and
          saying "nothing archived" would be a claim the view cannot make. */}
      {posts.length === 0 && status === 'loaded' && (
        <EmptyState
          title="Nothing archived yet."
          description="Archive a post from the reading list and it lands here."
        />
      )}

      {/* A read that never answered leaves the view with nothing to say for itself, which reads
          as an empty archive. Say what happened instead, and offer the read again. */}
      {status === 'failed' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the archive.</p>
          <Button variant="outline" size="sm" onClick={loadArchive}>
            Try again
          </Button>
        </div>
      )}

      {/* Beside the rows it qualifies, never on its own: an archive emptied by unarchiving
          everything would otherwise claim to be showing 200 of nothing. */}
      {full && posts.length > 0 && (
        <p className="text-sm text-muted-foreground">Showing the latest 200</p>
      )}
    </div>
  );
}
