import type { CodeFactoryState, CodeStory } from '@/lib/types';

import { refinementMarkTarget } from './refinement-mark';

type MarkSubject = Pick<CodeStory, 'factory_state' | 'spec_path'>;

function story(factoryState: CodeFactoryState | null, specPath: string | null = null): MarkSubject {
  return { factory_state: factoryState, spec_path: specPath };
}

describe('refinementMarkTarget', () => {
  describe('clearing the mark (this story needs no spec)', () => {
    it('fast-forwards a needs_refinement story to ready_for_dev', () => {
      expect(refinementMarkTarget(story('needs_refinement'), false)).toBe('ready_for_dev');
    });

    it('leaves a story that is already in ready_for_dev where it is', () => {
      expect(refinementMarkTarget(story('ready_for_dev'), false)).toBe('ready_for_dev');
    });

    it.each<CodeFactoryState>([
      'in_refinement',
      'in_development',
      'ready_for_review',
      'done',
      'blocked',
      'abandoned',
    ])('records the mark without moving a story in %s', (state) => {
      expect(refinementMarkTarget(story(state), false)).toBe(state);
    });
  });

  describe('re-setting the mark (this story needs a spec after all)', () => {
    it('rewinds a spec-less ready_for_dev story to needs_refinement', () => {
      expect(refinementMarkTarget(story('ready_for_dev'), true)).toBe('needs_refinement');
    });

    it('does NOT rewind a ready_for_dev story that has a committed spec', () => {
      // The spec exists whatever the flag now says; sending it back would ask for a second one.
      expect(refinementMarkTarget(story('ready_for_dev', 'docs/specs/ALF-42.html'), true)).toBe(
        'ready_for_dev',
      );
    });

    it('leaves a story that is already in needs_refinement where it is', () => {
      expect(refinementMarkTarget(story('needs_refinement'), true)).toBe('needs_refinement');
    });

    it.each<CodeFactoryState>([
      'in_refinement',
      'in_development',
      'ready_for_review',
      'done',
      'blocked',
      'abandoned',
    ])('records the mark without moving a story in %s', (state) => {
      expect(refinementMarkTarget(story(state), true)).toBe(state);
    });
  });

  // The view row types every column as nullable; a story with no state has nowhere to move
  // either, so it lands at the front of the lifecycle rather than at an invented hop.
  it('falls back to needs_refinement for a story with no factory_state', () => {
    expect(refinementMarkTarget(story(null), false)).toBe('needs_refinement');
    expect(refinementMarkTarget(story(null), true)).toBe('needs_refinement');
  });
});
