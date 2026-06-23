import { LAUNCH_LABELS, LAUNCH_TARGET_STATE, launchPhasesFor } from './launch';

describe('launchPhasesFor', () => {
  it('offers refinement first, then bypass, from needs_refinement', () => {
    expect(launchPhasesFor('needs_refinement')).toEqual(['refinement', 'bypass']);
  });

  it('offers implementation from ready_for_dev', () => {
    expect(launchPhasesFor('ready_for_dev')).toEqual(['implementation']);
  });

  it('offers nothing from any other happy-path or escape state', () => {
    expect(launchPhasesFor('in_refinement')).toEqual([]);
    expect(launchPhasesFor('in_development')).toEqual([]);
    expect(launchPhasesFor('ready_for_review')).toEqual([]);
    expect(launchPhasesFor('done')).toEqual([]);
    expect(launchPhasesFor('blocked')).toEqual([]);
    expect(launchPhasesFor('abandoned')).toEqual([]);
  });

  it('offers nothing when the state is unknown (null)', () => {
    expect(launchPhasesFor(null)).toEqual([]);
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
  });
});

describe('LAUNCH_TARGET_STATE', () => {
  it('maps each phase to its post-launch factory state', () => {
    expect(LAUNCH_TARGET_STATE.refinement).toBe('in_refinement');
    expect(LAUNCH_TARGET_STATE.implementation).toBe('in_development');
    // bypass skips in_refinement AND ready_for_dev — straight to dev.
    expect(LAUNCH_TARGET_STATE.bypass).toBe('in_development');
  });
});
