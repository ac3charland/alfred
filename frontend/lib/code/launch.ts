import type { CodeFactoryState } from '@/lib/types';

/** Which launch phase (if any) the launch action offers in a given factory state. */
export type LaunchPhase = 'refinement' | 'implementation';

/**
 * The launch phase a story in `state` can start: `refinement` from `needs_refinement`,
 * `implementation` from `ready_for_dev`, and nothing in every other (or unknown) state.
 */
export function launchPhaseFor(state: CodeFactoryState | null): LaunchPhase | undefined {
  if (state === 'needs_refinement') return 'refinement';
  if (state === 'ready_for_dev') return 'implementation';
  return undefined;
}

/** The button label + the in-flight (spinner) label for each launch phase. */
export const LAUNCH_LABELS: Record<LaunchPhase, { idle: string; busy: string }> = {
  refinement: { idle: 'Refine in Claude Code', busy: 'Opening refinement' },
  implementation: { idle: 'Implement in Claude Code', busy: 'Opening implementation' },
};
