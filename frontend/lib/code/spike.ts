import type { CodeStory } from '@/lib/types';

/** The title prefix that marks a story as a spike — matched case-insensitively. */
const SPIKE_PREFIX = 'spike:';

/**
 * Is this story a spike — a research session whose deliverable is a findings document rather
 * than a spec or code? Derived from the TITLE alone (nothing is persisted), so renaming a story
 * re-classifies it instantly, which is the right behaviour for a judgement the human makes in
 * the title anyway — and it costs no column, no migration and no view change.
 *
 * Matched on the left-trimmed, lower-cased title, so `Spike: `, `spike:` and a stray leading
 * space all read the same. The colon is part of the prefix: "Spike out the retry policy" is an
 * ordinary story, and the prefix must LEAD the title ("Fix the CPU spike: on dashboards" is not
 * a spike).
 */
export function isSpike(story: Pick<CodeStory, 'title'>): boolean {
  return (story.title ?? '').trimStart().toLowerCase().startsWith(SPIKE_PREFIX);
}
