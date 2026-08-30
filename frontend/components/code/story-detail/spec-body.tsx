'use client';

import { SpecView } from '@/components/code/spec-view';
import { viewInRepoUrl } from '@/components/code/story-detail/pr-link';
import { isSpike } from '@/lib/code/spike';
import type { CodeStory } from '@/lib/types';

/**
 * The long-form document a story produced, rendered through the shared spec view: a refinement
 * spec on an ordinary story, a spike's **findings** on a spike. Both are the same three columns
 * (`spec_path` / `spec_sha` / `spec_markdown`) — a story produces exactly one such document — so
 * only the label and the empty copy differ, each naming the PR that actually writes it.
 */
export function SpecBody({ story }: { story: CodeStory }) {
  const spike = isSpike(story);
  return (
    <SpecView
      spec={story.spec_markdown}
      repoUrl={viewInRepoUrl(story)}
      heading={spike ? 'Findings' : 'Spec'}
      emptyCopy={
        spike
          ? 'No findings yet. The spike PR writes them when it merges.'
          : 'No spec yet. The refinement PR writes it when it merges.'
      }
    />
  );
}
