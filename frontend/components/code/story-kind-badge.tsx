import { Badge, type BadgeProperties } from '@/components/atoms/badge';
import { type StoryKind, storyKindOf } from '@/lib/code/story-kind';
import type { CodeStory } from '@/lib/types';

/**
 * The chip each non-default {@link StoryKind} wears. Both are the same OUTLINE shape, differing
 * only in hue, so they read as one family — the kind of work this is — rather than as unrelated
 * chips. A **spike** stays muted: it labels a category, not a call to action, and the launch
 * control beside it already owns the card's accent. A **bug** takes the muted red, the outline
 * form so it stays a label; the filled `destructive` is the treatment the card already spends on
 * its Abandoned tag, and a bug is not an escape state.
 */
const KIND_BADGES: Record<
  Exclude<StoryKind, 'story'>,
  { label: string; variant: BadgeProperties['variant'] }
> = {
  spike: { label: 'Spike', variant: 'muted' },
  bug: { label: 'Bug', variant: 'destructiveOutline' },
};

/**
 * A small chip marking a story as a **spike** (research → findings document) or a **bug**
 * (reproduce → fix), the two kinds that skip refinement and run in one session. Rendered on the
 * board card (after the ref) and in the detail-modal header (after the state chip), so a kind
 * reads the same wherever it appears; renders nothing for an ordinary story.
 *
 * The kind is derived from the title (`storyKindOf`), so the badge follows a rename with no write.
 */
export function StoryKindBadge({ story }: { story: Pick<CodeStory, 'title'> }) {
  const kind = storyKindOf(story);
  // Narrowing beats indexing a Partial here: it keeps KIND_BADGES exhaustive over every kind
  // that HAS a badge, so adding a fourth kind is a type error until it gets one.
  if (kind === 'story') return null;
  const badge = KIND_BADGES[kind];
  return (
    <Badge variant={badge.variant} className="font-medium">
      {badge.label}
    </Badge>
  );
}
