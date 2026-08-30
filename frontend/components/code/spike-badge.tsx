import { Badge } from '@/components/atoms/badge';
import { isSpike } from '@/lib/code/spike';
import type { CodeStory } from '@/lib/types';

/**
 * A small muted chip marking a story as a **spike** — a research session whose deliverable is a
 * findings document. Rendered on the board card (after the ref) and in the detail-modal header
 * (after the state chip), so a spike reads as one wherever it appears; renders nothing for an
 * ordinary story.
 *
 * Deliberately NOT teal: it labels a category, not a call to action, and the launch control
 * beside it already owns the card's accent. Spike-ness is derived from the title
 * (`isSpike`), so the badge follows a rename with no write.
 */
export function SpikeBadge({ story }: { story: Pick<CodeStory, 'title'> }) {
  if (!isSpike(story)) return null;
  return (
    <Badge variant="muted" className="font-medium">
      Spike
    </Badge>
  );
}
