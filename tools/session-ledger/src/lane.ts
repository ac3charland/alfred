import type { AlfredFrontmatter } from '../../../workers/src/frontmatter.ts';
import type { LaunchLane } from './types.ts';

/**
 * Which launch prompt started a session, inferred from its PR's `alfred` block — nothing records
 * the button that was clicked. Each lane names the `frontend/lib/code/links.ts` builder that
 * produced its prompt.
 */

export type BuilderName =
  | 'buildRefinementUrl'
  | 'buildSpikeUrl'
  | 'buildBugUrl'
  | 'buildEpicRefinementUrl'
  | 'buildEpicImplementationUrl'
  | 'buildImplementationUrl'
  | 'buildBypassUrl';

export interface Lane {
  lane: LaunchLane;
  builder: BuilderName;
}

/**
 * A title the Code module reads as a bug: `bug:` after leading whitespace, any case — the same
 * test as `storyKindOf` in frontend/lib/code/story-kind.ts.
 */
function isBugTitle(title: string | null): boolean {
  return (title ?? '').trimStart().toLowerCase().startsWith('bug:');
}

/**
 * The lane for a PR's block. A spec-less implementation is the bug lane only when the story is
 * titled as a bug AND `buildBugUrl` existed in the builder of the time (`hasBuilder`); before
 * that, a bug launched through the bypass prompt. `storyTitle` is the story's, not the PR's.
 */
export function laneFor(
  block: AlfredFrontmatter | undefined,
  storyTitle: string | null,
  hasBuilder: (name: BuilderName) => boolean,
): Lane | undefined {
  if (block === undefined) return undefined;
  switch (block.phase) {
    case 'refinement': {
      return { lane: 'refinement', builder: 'buildRefinementUrl' };
    }
    case 'spike': {
      return { lane: 'spike', builder: 'buildSpikeUrl' };
    }
    case 'epic-refinement': {
      return { lane: 'epic-refinement', builder: 'buildEpicRefinementUrl' };
    }
    case 'epic-implementation': {
      return { lane: 'epic-implementation', builder: 'buildEpicImplementationUrl' };
    }
    case 'implementation': {
      if (block.specPath !== undefined) {
        return { lane: 'implementation', builder: 'buildImplementationUrl' };
      }
      if (isBugTitle(storyTitle) && hasBuilder('buildBugUrl')) {
        return { lane: 'bug', builder: 'buildBugUrl' };
      }
      return { lane: 'bypass', builder: 'buildBypassUrl' };
    }
  }
}
