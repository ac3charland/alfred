'use client';

import * as React from 'react';

import { EmptyState } from '@/components/atoms/empty-state';
import { localISODate } from '@/lib/date-utils';
import { useWikiPages } from '@/lib/stores/wiki-store';
import { conceptOfTheDay } from '@/lib/wiki/concept-of-the-day';
import { buildWikiWeb } from '@/lib/wiki/web/graph';

import { ConceptOfTheDayCard } from './concept-of-the-day-card';
import { WikiWeb } from './web/wiki-web';
import { WikiPageGroup } from './wiki-page-group';
import { WikiSearchable } from './wiki-searchable';

interface WikiLandingViewProperties {
  /** The clock the day's concept is read from; the landing moves to the next one at midnight. */
  now: Date;
  /** Force the web's reduced-motion path (stories, tests); otherwise it follows the OS setting. */
  reducedMotion?: boolean | undefined;
}

/**
 * `/wiki`: the search box, today's concept, then the web of every concept and entity with today's
 * concept at its heart — nothing below it. Sources and questions, and the full list of any
 * section, live in the nav's section views, so the landing is an overview rather than an index.
 *
 * The day is the local calendar date of `now`, so the card and the web's focus roll over at
 * midnight in a tab left open.
 */
export function WikiLandingView({ now, reducedMotion }: WikiLandingViewProperties) {
  const pages = useWikiPages();
  const today = localISODate(now);
  const concept = React.useMemo(() => conceptOfTheDay(pages, today), [pages, today]);
  const web = React.useMemo(() => buildWikiWeb(pages), [pages]);
  const headingId = React.useId();

  return (
    <WikiSearchable>
      {web.nodes.length === 0 ? (
        <EmptyState
          title="No concepts or entities yet"
          description="Sources and questions are listed in the nav."
        />
      ) : (
        <>
          {concept === undefined ? null : <ConceptOfTheDayCard page={concept} date={today} />}
          <WikiPageGroup title="Concepts & entities" count={web.nodes.length} headingId={headingId}>
            <WikiWeb
              nodes={web.nodes}
              edges={web.edges}
              focusPath={concept?.path ?? null}
              labelledBy={headingId}
              reducedMotion={reducedMotion}
            />
          </WikiPageGroup>
        </>
      )}
    </WikiSearchable>
  );
}
