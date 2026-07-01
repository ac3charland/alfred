import { ExternalLink } from 'lucide-react';

/**
 * The **Review PR** card affordance: a compact bordered chip that navigates to a story's open
 * pull request in a new tab. It mirrors the `LaunchButton` chip's geometry and accent (so the
 * card footer reads as one row of chips) but is an `<a>` — it navigates, it does not launch a
 * session — reusing the detail modal's `PrLink` icon-plus-label idiom (`ExternalLink` + label).
 *
 * Rendered by the story card OUTSIDE the `ClickableCard` body, so a click opens the PR without
 * firing the card's `onOpen`, exactly like the launch chips.
 */
export function ReviewPrChip({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={
        'inline-flex items-center gap-1.5 rounded-md border border-accent-blue/40 bg-accent-blue/10 px-2 py-1 text-xs font-medium text-accent-blue ' +
        'transition-colors duration-100 hover:bg-accent-blue/20 motion-reduce:transition-none ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue'
      }
    >
      <ExternalLink size={12} className="shrink-0" />
      Review PR
    </a>
  );
}
