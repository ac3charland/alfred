import type { CodeFactoryState } from '@/lib/types';

import { LAUNCH_LABELS, LAUNCH_TARGET_STATE, launchPhasesFor } from './launch';

/** An ordinary (non-spike) story in `state` — only the two fields the rule reads. */
function storyIn(state: CodeFactoryState | null) {
  return { factory_state: state, title: 'Verify the GitHub webhook HMAC signature' };
}

/** A story of a single-session kind in `state` — same shape, with the classifying title prefix. */
function kindIn(prefix: string, state: CodeFactoryState | null) {
  return { factory_state: state, title: `${prefix}: outbound notifications via Telegram` };
}

describe('launchPhasesFor', () => {
  it('offers refinement first, then bypass, from needs_refinement', () => {
    expect(launchPhasesFor(storyIn('needs_refinement'))).toEqual(['refinement', 'bypass']);
  });

  it('offers implementation from ready_for_dev', () => {
    expect(launchPhasesFor(storyIn('ready_for_dev'))).toEqual(['implementation']);
  });

  it('offers nothing from any other happy-path or escape state', () => {
    expect(launchPhasesFor(storyIn('in_refinement'))).toEqual([]);
    expect(launchPhasesFor(storyIn('in_development'))).toEqual([]);
    expect(launchPhasesFor(storyIn('ready_for_review'))).toEqual([]);
    expect(launchPhasesFor(storyIn('done'))).toEqual([]);
    expect(launchPhasesFor(storyIn('blocked'))).toEqual([]);
    expect(launchPhasesFor(storyIn('abandoned'))).toEqual([]);
  });

  it('offers nothing when the state is unknown (null)', () => {
    expect(launchPhasesFor(storyIn(null))).toEqual([]);
  });

  // A spike and a bug are both ONE session that skips refinement, so they offer the same
  // single-phase shape — only the phase's name differs.
  describe.each([
    { kind: 'spike', prefix: 'Spike' },
    { kind: 'bug', prefix: 'Bug' },
  ])('a $kind story', ({ kind, prefix }) => {
    it('offers its own session — and only that — from both pre-work states', () => {
      expect(launchPhasesFor(kindIn(prefix, 'needs_refinement'))).toEqual([kind]);
      expect(launchPhasesFor(kindIn(prefix, 'ready_for_dev'))).toEqual([kind]);
    });

    it('offers nothing in any other state', () => {
      expect(launchPhasesFor(kindIn(prefix, 'in_refinement'))).toEqual([]);
      expect(launchPhasesFor(kindIn(prefix, 'in_development'))).toEqual([]);
      expect(launchPhasesFor(kindIn(prefix, 'ready_for_review'))).toEqual([]);
      expect(launchPhasesFor(kindIn(prefix, 'done'))).toEqual([]);
      expect(launchPhasesFor(kindIn(prefix, 'blocked'))).toEqual([]);
      expect(launchPhasesFor(kindIn(prefix, 'abandoned'))).toEqual([]);
      expect(launchPhasesFor(kindIn(prefix, null))).toEqual([]);
    });
  });
});

describe('LAUNCH_LABELS', () => {
  it('has an idle + busy label for each launch phase', () => {
    expect(LAUNCH_LABELS.refinement).toEqual({
      idle: 'Refine in Claude Code',
      busy: 'Opening refinement',
    });
    expect(LAUNCH_LABELS.implementation).toEqual({
      idle: 'Implement in Claude Code',
      busy: 'Opening implementation',
    });
    expect(LAUNCH_LABELS.bypass).toEqual({
      idle: 'Skip to Development',
      busy: 'Opening development',
    });
    expect(LAUNCH_LABELS.spike).toEqual({
      idle: 'Run spike in Claude Code',
      busy: 'Opening spike',
    });
    expect(LAUNCH_LABELS.bug).toEqual({
      idle: 'Fix bug in Claude Code',
      busy: 'Opening bug fix',
    });
  });
});

describe('LAUNCH_TARGET_STATE', () => {
  it('maps each phase to its post-launch factory state', () => {
    expect(LAUNCH_TARGET_STATE.refinement).toBe('in_refinement');
    expect(LAUNCH_TARGET_STATE.implementation).toBe('in_development');
    // bypass skips in_refinement AND ready_for_dev — straight to dev.
    expect(LAUNCH_TARGET_STATE.bypass).toBe('in_development');
    // A spike is one session: it produces the findings, so there is no separate build phase.
    expect(LAUNCH_TARGET_STATE.spike).toBe('in_development');
    // A bug is likewise one session — it reproduces and fixes, with no spec phase before it.
    expect(LAUNCH_TARGET_STATE.bug).toBe('in_development');
  });
});
