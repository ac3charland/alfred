import { nextBlockedFrom } from './blocked';

describe('nextBlockedFrom', () => {
  it('remembers the happy-path state a story is blocked from', () => {
    expect(
      nextBlockedFrom({ factory_state: 'in_development', blocked_from: null }, 'blocked'),
    ).toBe('in_development');
  });

  it('remembers each happy-path origin, not just one', () => {
    expect(
      nextBlockedFrom({ factory_state: 'needs_refinement', blocked_from: null }, 'blocked'),
    ).toBe('needs_refinement');
    expect(
      nextBlockedFrom({ factory_state: 'ready_for_review', blocked_from: null }, 'blocked'),
    ).toBe('ready_for_review');
  });

  it('keeps the ORIGINAL origin when an already-blocked story is re-written (a reason edit)', () => {
    // Re-blocking must not overwrite the remembered lane with 'blocked' itself.
    expect(
      nextBlockedFrom({ factory_state: 'blocked', blocked_from: 'ready_for_dev' }, 'blocked'),
    ).toBe('ready_for_dev');
  });

  it('records no origin when blocking an abandoned story (it has no lane)', () => {
    expect(
      nextBlockedFrom({ factory_state: 'abandoned', blocked_from: null }, 'blocked'),
    ).toBeNull();
  });

  it('clears the origin when the story leaves blocked', () => {
    expect(
      nextBlockedFrom({ factory_state: 'blocked', blocked_from: 'in_refinement' }, 'in_refinement'),
    ).toBeNull();
  });

  it('clears the origin when the story is abandoned', () => {
    expect(
      nextBlockedFrom({ factory_state: 'blocked', blocked_from: 'in_development' }, 'abandoned'),
    ).toBeNull();
  });

  it('leaves a never-blocked story with no origin on an ordinary hop', () => {
    expect(
      nextBlockedFrom({ factory_state: 'ready_for_dev', blocked_from: null }, 'in_development'),
    ).toBeNull();
  });

  it('records no origin when the current state is unknown (a null view column)', () => {
    expect(nextBlockedFrom({ factory_state: null, blocked_from: null }, 'blocked')).toBeNull();
  });
});
