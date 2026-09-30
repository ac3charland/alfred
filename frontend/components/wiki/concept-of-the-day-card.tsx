import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { SurfaceCard } from '@/components/atoms/surface-card';
import { ViewLink } from '@/components/tasks/view-link';
import { toUtcMillis } from '@/lib/date-utils';
import type { WikiPageIndexRow } from '@/lib/types';
import { wikiPageHref } from '@/lib/wiki/sections';

import {
  conceptCardClass,
  conceptCardHeaderClass,
  conceptDateClass,
  conceptSummaryClass,
  conceptTagsClass,
  conceptTitleLinkClass,
} from './concept-of-the-day-card.styles';
import { eyebrowClass } from './wiki.styles';

/**
 * "Wed, Sep 30". Formatted in UTC because the date is a calendar day, not an instant: it is
 * turned into that day's UTC midnight (`toUtcMillis`) and read back in UTC, so no machine's time
 * zone can move it to the day before or after.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

interface ConceptOfTheDayCardProperties {
  /** The concept featured today. */
  page: WikiPageIndexRow;
  /** The local calendar day it is featured on, `YYYY-MM-DD`. */
  date: string;
}

/**
 * The wiki landing's concept of the day: an eyebrow and the date, the concept's title, its
 * summary and its tags, all on one card that opens the page. Only the title is a link, stretched
 * over the card, so the card is one target for a pointer while a keyboard or screen-reader user
 * meets a single link named by the title. The summary and the tags are left out when the page has
 * none, so a bare concept is a title under its eyebrow rather than a card with gaps.
 */
export function ConceptOfTheDayCard({ page, date }: ConceptOfTheDayCardProperties) {
  const labelId = React.useId();

  return (
    <section aria-labelledby={labelId}>
      <SurfaceCard className={conceptCardClass}>
        <div className={conceptCardHeaderClass}>
          <p id={labelId} className={eyebrowClass}>
            Concept of the day
          </p>
          <time dateTime={date} className={conceptDateClass}>
            {DATE_FORMAT.format(toUtcMillis(date))}
          </time>
        </div>
        <ViewLink href={wikiPageHref(page.path)} className={conceptTitleLinkClass}>
          {page.title}
        </ViewLink>
        {page.summary.trim() === '' ? null : <p className={conceptSummaryClass}>{page.summary}</p>}
        {page.tags.length === 0 ? null : (
          <div className={conceptTagsClass}>
            {page.tags.map((tag) => (
              <Badge key={tag} variant="muted">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </SurfaceCard>
    </section>
  );
}
