import { Library } from 'lucide-react';
import * as React from 'react';

import { ViewHeading } from '@/components/atoms/view-heading';
import { useWikiPages, useWikiSync } from '@/lib/stores/wiki-store';

import { wikiHeaderDescription, wikiSyncFailureLine } from './wiki-format';

/**
 * The module's heading: how many pages the snapshot holds and how fresh it is, and — when the
 * last sync failed after the last one that worked — an amber line saying the view is showing an
 * older snapshot, and how much older.
 */
export function WikiHeader({ now }: { now: Date }) {
  const pages = useWikiPages();
  const sync = useWikiSync();
  const failure = wikiSyncFailureLine(sync, now);

  return (
    <div className="flex flex-col gap-2">
      <ViewHeading
        icon={Library}
        title="Wiki"
        description={wikiHeaderDescription(pages.length, sync, now)}
        accent="wiki"
      />
      {failure === undefined ? null : <p className="text-sm text-accent-amber">{failure}</p>}
    </div>
  );
}
