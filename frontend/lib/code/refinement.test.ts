import {
  REFINEMENT_STATES,
  canBeRefined,
  canMoveToState,
  isRefinementState,
  renameStateChange,
  requiresRefinementFor,
} from './refinement';

describe('isRefinementState', () => {
  it('is true for exactly the two spec-writing lanes', () => {
    expect(REFINEMENT_STATES).toStrictEqual(['needs_refinement', 'in_refinement']);
    expect(isRefinementState('needs_refinement')).toBe(true);
    expect(isRefinementState('in_refinement')).toBe(true);
  });

  it('is false for every other state and for a missing one', () => {
    expect(isRefinementState('ready_for_dev')).toBe(false);
    expect(isRefinementState('in_development')).toBe(false);
    expect(isRefinementState('ready_for_review')).toBe(false);
    expect(isRefinementState('done')).toBe(false);
    expect(isRefinementState('blocked')).toBe(false);
    expect(isRefinementState('abandoned')).toBe(false);
    expect(isRefinementState(null)).toBe(false);
  });
});

describe('canBeRefined', () => {
  it('is true for an ordinary story', () => {
    expect(canBeRefined({ title: 'Verify the GitHub webhook HMAC signature' })).toBe(true);
    expect(canBeRefined({ title: null })).toBe(true);
  });

  it('is false for a bug and a spike', () => {
    expect(canBeRefined({ title: 'Bug: the capture box keeps its draft' })).toBe(false);
    expect(canBeRefined({ title: 'Spike: which queue?' })).toBe(false);
  });
});

describe('canMoveToState', () => {
  it('lets an ordinary story into every lane', () => {
    const story = { title: 'Wire up the webhook handler' };
    expect(canMoveToState(story, 'needs_refinement')).toBe(true);
    expect(canMoveToState(story, 'in_refinement')).toBe(true);
    expect(canMoveToState(story, 'ready_for_dev')).toBe(true);
  });

  it.each(['Bug: the toast never clears', 'Spike: which queue?'])(
    'keeps %s out of the two refinement lanes',
    (title) => {
      expect(canMoveToState({ title }, 'needs_refinement')).toBe(false);
      expect(canMoveToState({ title }, 'in_refinement')).toBe(false);
    },
  );

  it.each(['Bug: the toast never clears', 'Spike: which queue?'])(
    'still lets %s move anywhere else',
    (title) => {
      expect(canMoveToState({ title }, 'ready_for_dev')).toBe(true);
      expect(canMoveToState({ title }, 'in_development')).toBe(true);
      expect(canMoveToState({ title }, 'ready_for_review')).toBe(true);
      expect(canMoveToState({ title }, 'done')).toBe(true);
      expect(canMoveToState({ title }, 'blocked')).toBe(true);
      expect(canMoveToState({ title }, 'abandoned')).toBe(true);
    },
  );
});

describe('requiresRefinementFor', () => {
  it('honours the author for an ordinary story', () => {
    expect(requiresRefinementFor('Wire up the webhook handler', true)).toBe(true);
    expect(requiresRefinementFor('Wire up the webhook handler', false)).toBe(false);
  });

  it('is false for a bug or a spike however the caller asked', () => {
    expect(requiresRefinementFor('Bug: the toast never clears', true)).toBe(false);
    expect(requiresRefinementFor('Spike: which queue?', true)).toBe(false);
  });
});

describe('renameStateChange', () => {
  const bug = { title: 'Bug: the toast never clears', spec_path: null };

  it('sends a story renamed into a bug or spike out of a refinement lane', () => {
    for (const state of REFINEMENT_STATES) {
      expect(
        renameStateChange(
          { title: 'The toast never clears', spec_path: null, factory_state: state },
          'Bug: the toast never clears',
        ),
      ).toStrictEqual({ factory_state: 'ready_for_dev', requires_refinement: false });
      expect(
        renameStateChange(
          { title: 'Which queue?', spec_path: null, factory_state: state },
          'Spike: which queue?',
        ),
      ).toStrictEqual({ factory_state: 'ready_for_dev', requires_refinement: false });
    }
  });

  it('leaves a story renamed into a bug alone when it is past refinement', () => {
    for (const state of [
      'ready_for_dev',
      'in_development',
      'ready_for_review',
      'done',
      'blocked',
      'abandoned',
    ] as const) {
      expect(
        renameStateChange(
          { title: 'The toast never clears', spec_path: null, factory_state: state },
          'Bug: the toast never clears',
        ),
      ).toBeNull();
    }
  });

  it('sends a bug or spike renamed back into a story from Ready for Dev to Needs Refinement', () => {
    expect(
      renameStateChange({ ...bug, factory_state: 'ready_for_dev' }, 'The toast never clears'),
    ).toStrictEqual({
      factory_state: 'needs_refinement',
      requires_refinement: true,
    });
    expect(
      renameStateChange(
        { title: 'Spike: which queue?', spec_path: null, factory_state: 'ready_for_dev' },
        'Pick the queue',
      ),
    ).toStrictEqual({ factory_state: 'needs_refinement', requires_refinement: true });
  });

  it('keeps a bug renamed back into a story in its current lane everywhere else', () => {
    for (const state of [
      'in_development',
      'ready_for_review',
      'done',
      'blocked',
      'abandoned',
    ] as const) {
      expect(
        renameStateChange({ ...bug, factory_state: state }, 'The toast never clears'),
      ).toBeNull();
    }
  });

  it('never rewinds a story that already has a committed spec', () => {
    expect(
      renameStateChange(
        {
          title: 'Bug: the toast never clears',
          spec_path: 'docs/specs/ALF-9.md',
          factory_state: 'ready_for_dev',
        },
        'The toast never clears',
      ),
    ).toBeNull();
  });

  it('is a no-op when the rename does not cross the kind boundary', () => {
    expect(
      renameStateChange(
        { ...bug, factory_state: 'ready_for_dev' },
        'Bug: the toast still never clears',
      ),
    ).toBeNull();
    expect(
      renameStateChange(
        { ...bug, factory_state: 'ready_for_dev' },
        'Spike: why does the toast linger?',
      ),
    ).toBeNull();
    expect(
      renameStateChange(
        { title: 'Wire up the handler', spec_path: null, factory_state: 'needs_refinement' },
        'Wire up the webhook handler',
      ),
    ).toBeNull();
  });

  it('never throws on the view row’s nullable title and state', () => {
    expect(
      renameStateChange({ title: null, spec_path: null, factory_state: null }, 'Bug: a defect'),
    ).toBeNull();
  });
});
