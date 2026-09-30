import type { AlfredFrontmatter } from '../../../workers/src/frontmatter.ts';
import { laneFor } from './lane.ts';

const block = (phase: AlfredFrontmatter['phase'], specPath?: string): AlfredFrontmatter => ({
  tickets: ['ALF-9'],
  phase,
  specPath,
});
const every = () => true;
const noBug = (name: string) => name !== 'buildBugUrl';

describe('laneFor', () => {
  it.each([
    [
      'refinement',
      block('refinement', 'docs/specs/ALF-9.html'),
      'refinement',
      'buildRefinementUrl',
    ],
    ['spike', block('spike', 'docs/spikes/ALF-9.html'), 'spike', 'buildSpikeUrl'],
    [
      'epic-refinement',
      block('epic-refinement', 'x.html'),
      'epic-refinement',
      'buildEpicRefinementUrl',
    ],
    [
      'epic-implementation',
      block('epic-implementation'),
      'epic-implementation',
      'buildEpicImplementationUrl',
    ],
    [
      'implementation + spec-path',
      block('implementation', 'docs/specs/ALF-9.html'),
      'implementation',
      'buildImplementationUrl',
    ],
    ['implementation, no spec-path', block('implementation'), 'bypass', 'buildBypassUrl'],
  ])('maps %s', (_label, parsed, lane, builder) => {
    expect(laneFor(parsed, 'A story', every)).toEqual({ lane, builder });
  });

  it('maps a spec-less implementation of a "Bug:" story to the bug lane when buildBugUrl exists', () => {
    expect(laneFor(block('implementation'), '  bug: it broke', every)).toEqual({
      lane: 'bug',
      builder: 'buildBugUrl',
    });
    expect(laneFor(block('implementation'), 'BUG: shouting', every)?.lane).toBe('bug');
  });

  it('maps the same story to bypass when buildBugUrl did not exist yet at that builder', () => {
    expect(laneFor(block('implementation'), 'Bug: it broke', noBug)).toEqual({
      lane: 'bypass',
      builder: 'buildBypassUrl',
    });
  });

  it('does not read "Bug" without the colon, or mid-title, as a bug', () => {
    expect(laneFor(block('implementation'), 'Bugfix sweep', every)?.lane).toBe('bypass');
    expect(laneFor(block('implementation'), 'Fix bug: x', every)?.lane).toBe('bypass');
    expect(laneFor(block('implementation'), null, every)?.lane).toBe('bypass');
  });

  it('has no lane without a block', () => {
    expect(laneFor(undefined, 'A story', every)).toBeUndefined();
  });
});
