import { LAUNCH_LABELS, launchPhaseFor } from './launch';

describe('launchPhaseFor', () => {
  it('offers refinement from needs_refinement', () => {
    expect(launchPhaseFor('needs_refinement')).toBe('refinement');
  });

  it('offers implementation from ready_for_dev', () => {
    expect(launchPhaseFor('ready_for_dev')).toBe('implementation');
  });

  it('offers nothing from any other happy-path or escape state', () => {
    expect(launchPhaseFor('in_refinement')).toBeUndefined();
    expect(launchPhaseFor('in_development')).toBeUndefined();
    expect(launchPhaseFor('blocked')).toBeUndefined();
    expect(launchPhaseFor('abandoned')).toBeUndefined();
  });

  it('offers nothing when the state is unknown (null)', () => {
    expect(launchPhaseFor(null)).toBeUndefined();
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
  });
});
