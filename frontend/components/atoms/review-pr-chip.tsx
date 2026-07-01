import { ExternalLink } from 'lucide-react';

import { CardChip } from '@/components/atoms/card-chip';

/**
 * The **Review PR** card affordance: a `CardChip` in the blue `link` tone rendered as an anchor
 * that navigates to a story's open pull request in a new tab. It reuses the detail modal's
 * `PrLink` icon-plus-label idiom (`ExternalLink` + label) and, like the launch chips, sits OUTSIDE
 * the card's `ClickableCard` body so a click opens the PR without firing the card's `onOpen`.
 */
export function ReviewPrChip({ url }: { url: string }) {
  return (
    <CardChip tone="link" href={url} target="_blank" rel="noreferrer">
      <ExternalLink size={12} className="shrink-0" />
      Review PR
    </CardChip>
  );
}
