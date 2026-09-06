'use client';

import { SpecView } from '@/components/code/spec-view';
import { viewInRepoUrl } from '@/components/code/story-detail/pr-link';
import { type StoryKind, storyKindOf } from '@/lib/code/story-kind';
import type { CodeStory } from '@/lib/types';

/**
 * What long-form document each kind produces, and what to say before it exists. All three read
 * the same three columns (`spec_path` / `spec_sha` / `spec_markdown`) — a story produces at most
 * one such document — so only the label and the empty copy differ, each naming the PR that
 * actually writes it. A BUG names none, because none ever comes: its one PR carries the fix.
 */
const KIND_DOCUMENT: Record<StoryKind, { heading: string; emptyCopy: string }> = {
  story: {
    heading: 'Spec',
    emptyCopy: 'No spec yet. The refinement PR writes it when it merges.',
  },
  spike: {
    heading: 'Findings',
    emptyCopy: 'No findings yet. The spike PR writes them when it merges.',
  },
  bug: {
    heading: 'Spec',
    emptyCopy: 'No spec — a bug goes straight to a fix. The fix PR is the whole record.',
  },
};

/**
 * The long-form document a story produced, rendered through the shared spec view: a refinement
 * spec on an ordinary story, a spike's findings on a spike, and nothing on a bug — which is
 * itself worth saying, so the empty copy tells the reader no spec is coming rather than leaving
 * them waiting for a refinement PR that will never open.
 */
export function SpecBody({ story }: { story: CodeStory }) {
  const { heading, emptyCopy } = KIND_DOCUMENT[storyKindOf(story)];
  return (
    <SpecView
      spec={story.spec_markdown}
      repoUrl={viewInRepoUrl(story)}
      heading={heading}
      emptyCopy={emptyCopy}
    />
  );
}
