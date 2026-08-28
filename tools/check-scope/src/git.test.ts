import { chooseTrunkRef } from './git.ts';

describe('chooseTrunkRef', () => {
  it('prefers the remote default branch when origin/HEAD is set', () => {
    expect(
      chooseTrunkRef({
        originHead: 'origin/trunk',
        remote: ['origin/main'],
        local: ['main'],
        hasOrigin: true,
      }),
    ).toBe('origin/trunk');
  });

  it('prefers a remote trunk ref over a local branch of the same name', () => {
    expect(
      chooseTrunkRef({
        originHead: undefined,
        remote: ['origin/main'],
        local: ['main'],
        hasOrigin: true,
      }),
    ).toBe('origin/main');
  });

  it('refuses a local trunk while an origin remote exists', () => {
    // The safety rule: a local `main` holding commits origin has not seen pushes the
    // merge-base forward and HIDES them from the changed set, so a docs-only branch stacked
    // on an unpushed code commit would skip the tier while the push carries that code out.
    // "Trunk unknown" runs the full tier instead.
    expect(
      chooseTrunkRef({ originHead: undefined, remote: [], local: ['main'], hasOrigin: true }),
    ).toBeUndefined();
  });

  it('falls back to a local trunk only when there is no origin remote', () => {
    expect(
      chooseTrunkRef({ originHead: undefined, remote: [], local: ['main'], hasOrigin: false }),
    ).toBe('main');
  });

  it('gives up when no trunk ref exists at all', () => {
    expect(
      chooseTrunkRef({ originHead: undefined, remote: [], local: [], hasOrigin: false }),
    ).toBeUndefined();
  });
});
