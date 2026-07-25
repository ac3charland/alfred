'use client';

import { SpecView } from '@/components/code/spec-view';
import { viewInRepoUrl } from '@/components/code/story-detail/pr-link';
import type { CodeStory } from '@/lib/types';

/** The story's spec, rendered through the shared spec view. */
export function SpecBody({ story }: { story: CodeStory }) {
  return (
    <SpecView
      spec={story.spec_markdown}
      repoUrl={viewInRepoUrl(story)}
      emptyCopy="No spec yet. The refinement PR writes it when it merges."
    />
  );
}
