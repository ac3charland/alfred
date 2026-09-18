'use client';

import { BookOpen } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/atoms/empty-state';
import { ViewHeading } from '@/components/atoms/view-heading';
import { ReadingListView } from '@/components/reader/reading-list-view';

/** The module's root; everything else hangs off it as `/reader/<segment>`. */
export const READER_PREFIX = '/reader';

const ARCHIVE_SEGMENT = 'archive';
const PUBLICATIONS_SEGMENT = 'publications';

/**
 * Client-side view router for the Reader module — the counterpart to `TaskViews` / `CodeView` /
 * `CommsView`. Every Reader page renders this one component, which derives the active view
 * purely from the URL, the same `pushState`-driven pattern the other modules use.
 *
 * The bare `/reader` (and any unrecognised segment) is the reading list — the module's default
 * and the reason it exists. The archive and publications segments are routed, named in the nav
 * and reachable from ⌘K already, but render only a heading and an empty state: the roster is
 * managed by SQL and archived posts are not yet browsable, so each says so rather than showing
 * a blank pane.
 */
export function ReaderView() {
  const pathname = usePathname();
  const segment = pathname.startsWith(`${READER_PREFIX}/`)
    ? pathname.slice(READER_PREFIX.length + 1)
    : '';

  if (segment === ARCHIVE_SEGMENT) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <ViewHeading icon={BookOpen} title="Archive" description="Reader" accent="reader" />
        <EmptyState
          title="Archived posts land here."
          description="Browsing them arrives with the next story."
        />
      </div>
    );
  }

  if (segment === PUBLICATIONS_SEGMENT) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <ViewHeading icon={BookOpen} title="Publications" description="Reader" accent="reader" />
        <EmptyState
          title="Publications are managed by SQL for now."
          description="A roster view arrives with the next story."
        />
      </div>
    );
  }

  // The reading list: bare `/reader` and any unrecognised segment, so a stale link lands
  // somewhere useful rather than blank.
  return <ReadingListView />;
}
