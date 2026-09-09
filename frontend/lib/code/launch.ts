import { storyKindOf } from '@/lib/code/story-kind';
import type { CodeFactoryState, CodeStory } from '@/lib/types';

/**
 * Which launch phase the launch action offers: refine, implement, skip-refinement (bypass), run a
 * spike (a research session whose deliverable is a findings document), or fix a bug (one session
 * that reproduces the defect and fixes it).
 *
 * `spike` and `bug` are deliberately named for the two single-session story kinds, so a kind IS
 * its phase — `launchPhasesFor` offers `[kind]` without a lookup table sitting between them.
 */
export type LaunchPhase = 'refinement' | 'implementation' | 'bypass' | 'spike' | 'bug';

/**
 * Which session an EPIC's launch opens: write the epic spec, or one-shot it into code. An epic
 * has no lifecycle state, so unlike {@link LaunchPhase} neither entry maps to a transition — the
 * phase only picks the prompt.
 */
export type EpicLaunchPhase = 'epic-refinement' | 'epic-implementation';

/**
 * The ordered list of launch phases a story offers (primary first, so the card/modal render them
 * in a stable order): `needs_refinement` offers `refinement` then `bypass` (skip straight to
 * dev), `ready_for_dev` offers `implementation`, and every other (or unknown) state offers none.
 *
 * A SPIKE or a BUG offers exactly ONE — its own session — from either pre-work state. Both
 * `needs_refinement` and `ready_for_dev` are reachable before that session runs (the refinement
 * mark, a reverted PR), and neither `refinement` nor `implementation` is the session either kind
 * wants. For a spike, one would spec work nobody has decided to do and the other would build it;
 * for a bug, refining a defect specs a change whose shape only reproducing it reveals, and the
 * plain implementation prompt would point the session at a spec file that was never written.
 */
export function launchPhasesFor(story: Pick<CodeStory, 'factory_state' | 'title'>): LaunchPhase[] {
  const state = story.factory_state;
  const kind = storyKindOf(story);
  if (kind !== 'story') {
    return state === 'needs_refinement' || state === 'ready_for_dev' ? [kind] : [];
  }
  if (state === 'needs_refinement') return ['refinement', 'bypass'];
  if (state === 'ready_for_dev') return ['implementation'];
  return [];
}

/** The button label + the in-flight (spinner) label for each launch phase. */
export const LAUNCH_LABELS: Record<LaunchPhase, { idle: string; busy: string }> = {
  refinement: { idle: 'Refine in Claude Code', busy: 'Opening refinement' },
  implementation: { idle: 'Implement in Claude Code', busy: 'Opening implementation' },
  bypass: { idle: 'Skip to Development', busy: 'Opening development' },
  spike: { idle: 'Run spike in Claude Code', busy: 'Opening spike' },
  bug: { idle: 'Fix bug in Claude Code', busy: 'Opening bug fix' },
};

/** The factory state a successful launch transitions the story into. */
export const LAUNCH_TARGET_STATE: Record<LaunchPhase, CodeFactoryState> = {
  refinement: 'in_refinement',
  implementation: 'in_development',
  bypass: 'in_development', // skip in_refinement AND ready_for_dev — go straight to dev
  spike: 'in_development', // one session produces the findings; there is no separate build phase
  bug: 'in_development', // likewise one session: reproduce and fix, with no spec phase before it
};
