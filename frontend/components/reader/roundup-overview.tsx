import * as React from 'react';

import { isBullet } from '@/lib/reader/overview';
import type { ReaderPostListItem, ReaderRoundupOverview } from '@/lib/types';
import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';

import { FurtherReading } from './further-reading';
import { plainBulletListClass } from './reader-checklist.styles';

/**
 * A `done` roundup's panel: Highlights — what in the issue itself might make the owner read on —
 * then Links, the pieces it links to that are worth reading in full. Links IS the Further reading
 * checklist under the roundup's own heading, with the same sends and sent marks; like Further
 * reading, an empty one draws nothing. An empty Highlights is a verdict, so it says so.
 *
 * Highlights are a plain list, never wiki picks: only an essay's bullets go to the wiki.
 */

const EMPTY_HIGHLIGHTS_LINE = 'Nothing stood out in the issue itself.';

export interface RoundupOverviewProperties {
  overview: ReaderRoundupOverview;
  /** The post the overview belongs to — what a Links send names and reads its sent marks from. */
  post: ReaderPostListItem;
  /** Whether this deployment can send to Instapaper — what makes Links a checklist. */
  instapaperConfigured: boolean;
}

export function RoundupOverview({
  overview,
  post,
  instapaperConfigured,
}: RoundupOverviewProperties) {
  const highlights = overview.highlights.filter((highlight) => isBullet(highlight));
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-3">
      <section>
        <h3 className={SECTION_HEADING_CLASS}>Highlights</h3>
        {highlights.length > 0 ? (
          <ul className={plainBulletListClass}>
            {highlights.map((highlight, index) => (
              <li key={index}>{highlight}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-foreground">{EMPTY_HIGHLIGHTS_LINE}</p>
        )}
      </section>

      {overview.further_reading.length > 0 && (
        <FurtherReading
          heading="Links"
          postId={post.id}
          items={overview.further_reading}
          sentReader={post.further_sent_reader}
          sentInstapaper={post.further_sent_instapaper}
          instapaperConfigured={instapaperConfigured}
        />
      )}
    </div>
  );
}
