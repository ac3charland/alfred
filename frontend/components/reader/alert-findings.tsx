import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import type { ReaderAlertCategory, ReaderAlertFinding } from '@/lib/types';

import {
  findingDetailClass,
  findingRowClass,
  findingsClass,
  supersededFindingsClass,
} from './post-row.styles';

/**
 * An Alerts post's findings, in the gist's place on its row: one line each, tagged with what it is
 * about. The finding is the whole value of an Alerts post, so it is shown, never folded behind the
 * Overview. Security wears the destructive tone; the rest share the amber alert one.
 *
 * Spans rather than a list: the row's text sits inside its card's button, which may hold only
 * phrasing content.
 */

const CATEGORY_LABEL: Readonly<Record<ReaderAlertCategory, string>> = {
  sale: 'Sale',
  security: 'Security',
  action: 'Action',
  change: 'Change',
};

/** What the row reads for an Alerts post the tick filed because it found nothing. */
export const NOTHING_NOTABLE_LINE = 'Nothing notable — filed automatically.';

/**
 * The deadline, when the mail stated one the detail doesn't already say — the model is asked for
 * both, and usually writes the date into the detail too.
 */
function deadlineSuffix({ detail, deadline }: ReaderAlertFinding): string {
  if (deadline === null || deadline.trim() === '' || detail.includes(deadline)) return '';
  return ` · by ${deadline}`;
}

export function AlertFindings({
  findings,
  superseded = false,
}: {
  findings: readonly ReaderAlertFinding[];
  /** A re-summarise is replacing them: dimmed, as a superseded gist is. */
  superseded?: boolean;
}) {
  return (
    <span
      className={superseded ? supersededFindingsClass : findingsClass}
      data-testid="alert-findings"
    >
      {findings.map((finding, index) => (
        <span key={index} className={findingRowClass}>
          <Badge variant={finding.category === 'security' ? 'destructive' : 'alert'}>
            {CATEGORY_LABEL[finding.category]}
          </Badge>
          <span className={findingDetailClass}>
            {finding.detail}
            {deadlineSuffix(finding)}
          </span>
        </span>
      ))}
    </span>
  );
}
