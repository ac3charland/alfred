import { isSpike } from '@/lib/code/spike';
import type { CodeFactoryState, CodeStory } from '@/lib/types';

/**
 * Which launch phase the launch action offers: refine, implement, skip-refinement (bypass), or
 * run a spike (a research session whose deliverable is a findings document).
 */
export type LaunchPhase = 'refinement' | 'implementation' | 'bypass' | 'spike';

/**
 * The ordered list of launch phases a story offers (primary first, so the card/modal render them
 * in a stable order): `needs_refinement` offers `refinement` then `bypass` (skip straight to
 * dev), `ready_for_dev` offers `implementation`, and every other (or unknown) state offers none.
 *
 * A SPIKE offers exactly ONE — its own session — from either pre-work state. Both
 * `needs_refinement` and `ready_for_dev` are reachable before the spike runs (the refinement
 * mark, a reverted PR), and neither `refinement` nor `implementation` is the session a spike
 * wants: one would spec work nobody has decided to do, the other would build it.
 */
export function launchPhasesFor(story: Pick<CodeStory, 'factory_state' | 'title'>): LaunchPhase[] {
  const state = story.factory_state;
  if (isSpike(story)) {
    return state === 'needs_refinement' || state === 'ready_for_dev' ? ['spike'] : [];
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
};

/** The factory state a successful launch transitions the story into. */
export const LAUNCH_TARGET_STATE: Record<LaunchPhase, CodeFactoryState> = {
  refinement: 'in_refinement',
  implementation: 'in_development',
  bypass: 'in_development', // skip in_refinement AND ready_for_dev — go straight to dev
  spike: 'in_development', // one session produces the findings; there is no separate build phase
};
