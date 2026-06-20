import { type PrEvent, planTransition } from './transitions';

const event = (overrides: Partial<PrEvent>): PrEvent => ({
  phase: 'refinement',
  action: 'opened',
  merged: false,
  prUrl: 'https://github.com/ac3charland/alfred/pull/1',
  specPath: undefined,
  ...overrides,
});

describe('planTransition', () => {
  describe('refinement phase', () => {
    it('opened → no state change, records refinement_pr_url', () => {
      const plan = planTransition(event({ action: 'opened', prUrl: 'https://x/pr/7' }));
      expect(plan).toEqual({
        updates: { refinement_pr_url: 'https://x/pr/7' },
        snapshotSpec: false,
      });
    });

    it('closed & merged → ready_for_dev, records spec_path, snapshots', () => {
      const plan = planTransition(
        event({ action: 'closed', merged: true, specPath: 'docs/specs/ALF-42.md' }),
      );
      expect(plan).toEqual({
        updates: { factory_state: 'ready_for_dev', spec_path: 'docs/specs/ALF-42.md' },
        snapshotSpec: true,
      });
    });

    it('closed & merged without a spec_path still advances and snapshots', () => {
      const plan = planTransition(event({ action: 'closed', merged: true, specPath: undefined }));
      // toStrictEqual (not toEqual) so a `spec_path: undefined` key — what the `if(specPath !==
      // undefined)` guard would wrongly add if it always ran — is caught as a difference.
      expect(plan).toStrictEqual({
        updates: { factory_state: 'ready_for_dev' },
        snapshotSpec: true,
      });
    });

    it('closed & unmerged → reverts to needs_refinement', () => {
      const plan = planTransition(event({ action: 'closed', merged: false }));
      expect(plan).toEqual({ updates: { factory_state: 'needs_refinement' }, snapshotSpec: false });
    });
  });

  describe('implementation phase', () => {
    it('opened → ready_for_review, records implementation_pr_url', () => {
      const plan = planTransition(
        event({ phase: 'implementation', action: 'opened', prUrl: 'https://x/pr/9' }),
      );
      expect(plan).toEqual({
        updates: { factory_state: 'ready_for_review', implementation_pr_url: 'https://x/pr/9' },
        snapshotSpec: false,
      });
    });

    it('closed & merged → done', () => {
      const plan = planTransition(
        event({ phase: 'implementation', action: 'closed', merged: true }),
      );
      expect(plan).toEqual({ updates: { factory_state: 'done' }, snapshotSpec: false });
    });

    it('closed & unmerged → reverts to ready_for_dev', () => {
      const plan = planTransition(
        event({ phase: 'implementation', action: 'closed', merged: false }),
      );
      expect(plan).toEqual({ updates: { factory_state: 'ready_for_dev' }, snapshotSpec: false });
    });
  });

  it.each(['edited', 'synchronize', 'reopened', 'assigned'])(
    'returns undefined for the no-op action %s',
    (action) => {
      expect(planTransition(event({ action }))).toBeUndefined();
      expect(planTransition(event({ phase: 'implementation', action }))).toBeUndefined();
    },
  );
});
