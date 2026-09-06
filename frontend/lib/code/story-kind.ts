import type { CodeStory } from '@/lib/types';

/**
 * What KIND of work a story is, and therefore which session it launches: an ordinary `story`
 * (refine, then implement), a `spike` (one research session producing a findings document), or a
 * `bug` (one session that reproduces and fixes a defect). Spikes and bugs both skip refinement —
 * neither is work you spec before doing.
 */
export type StoryKind = 'story' | 'spike' | 'bug';

/**
 * The title prefix that marks each non-default kind — matched case-insensitively. `story` has no
 * prefix; it is what a title that claims neither of these is.
 */
const KIND_PREFIXES: readonly (readonly [Exclude<StoryKind, 'story'>, string])[] = [
  ['spike', 'spike:'],
  ['bug', 'bug:'],
];

/**
 * Which kind this story is, derived from the TITLE alone (nothing is persisted), so renaming a
 * story re-classifies it instantly — the right behaviour for a judgement the human makes in the
 * title anyway, and it costs no column, no migration and no view change.
 *
 * Matched on the left-trimmed, lower-cased title, so `Spike: `, `spike:` and a stray leading space
 * all read the same. The colon is part of the prefix: "Spike out the retry policy" is an ordinary
 * story, and the prefix must LEAD the title ("Fix the CPU spike: on dashboards" is not a spike).
 */
export function storyKindOf(story: Pick<CodeStory, 'title'>): StoryKind {
  const title = (story.title ?? '').trimStart().toLowerCase();
  return KIND_PREFIXES.find(([, prefix]) => title.startsWith(prefix))?.[0] ?? 'story';
}

/** Is this story a spike — a research session whose deliverable is a findings document? */
export function isSpike(story: Pick<CodeStory, 'title'>): boolean {
  return storyKindOf(story) === 'spike';
}

/** Is this story a bug — a defect that goes straight to a fix, with no spec in between? */
export function isBug(story: Pick<CodeStory, 'title'>): boolean {
  return storyKindOf(story) === 'bug';
}
