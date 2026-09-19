'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ArchiveView } from '@/components/reader/archive-view';
import { PublicationsView } from '@/components/reader/publications-view';
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
 * and the reason it exists. The archive and publications segments own their own components, so
 * this stays a router: which segment renders what, and nothing else.
 */
export function ReaderView() {
  const pathname = usePathname();
  const segment = pathname.startsWith(`${READER_PREFIX}/`)
    ? pathname.slice(READER_PREFIX.length + 1)
    : '';

  if (segment === ARCHIVE_SEGMENT) return <ArchiveView />;

  if (segment === PUBLICATIONS_SEGMENT) return <PublicationsView />;

  // The reading list: bare `/reader` and any unrecognised segment, so a stale link lands
  // somewhere useful rather than blank.
  return <ReadingListView />;
}
