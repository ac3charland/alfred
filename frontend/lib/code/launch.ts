import type { CodeFactoryState } from '@/lib/types';

/** Which launch phase the launch action offers: refine, implement, or skip-refinement (bypass). */
export type LaunchPhase = 'refinement' | 'implementation' | 'bypass';

/**
 * The ordered list of launch phases a story in `state` offers (primary first, so the card/modal
 * render them in a stable order): `needs_refinement` offers `refinement` then `bypass` (skip
 * straight to dev), `ready_for_dev` offers `implementation`, and every other (or unknown) state
 * offers none.
 */
export function launchPhasesFor(state: CodeFactoryState | null): LaunchPhase[] {
  if (state === 'needs_refinement') return ['refinement', 'bypass'];
  if (state === 'ready_for_dev') return ['implementation'];
  return [];
}

/** The button label + the in-flight (spinner) label for each launch phase. */
export const LAUNCH_LABELS: Record<LaunchPhase, { idle: string; busy: string }> = {
  refinement: { idle: 'Refine in Claude Code', busy: 'Opening refinement' },
  implementation: { idle: 'Implement in Claude Code', busy: 'Opening implementation' },
  bypass: { idle: 'Skip to Development', busy: 'Opening development' },
};

/** The factory state a successful launch transitions the story into. */
export const LAUNCH_TARGET_STATE: Record<LaunchPhase, CodeFactoryState> = {
  refinement: 'in_refinement',
  implementation: 'in_development',
  bypass: 'in_development', // skip in_refinement AND ready_for_dev — go straight to dev
};
