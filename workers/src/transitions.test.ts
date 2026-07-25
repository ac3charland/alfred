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
        target: 'story',
        updates: { refinement_pr_url: 'https://x/pr/7' },
        snapshotSpec: false,
      });
    });

    it('closed & merged → ready_for_dev, records spec_path, snapshots', () => {
      const plan = planTransition(
        event({ action: 'closed', merged: true, specPath: 'docs/specs/ALF-42.md' }),
      );
      expect(plan).toEqual({
        target: 'story',
        updates: { factory_state: 'ready_for_dev', spec_path: 'docs/specs/ALF-42.md' },
        snapshotSpec: true,
      });
    });

    it('closed & merged without a spec_path still advances and snapshots', () => {
      const plan = planTransition(event({ action: 'closed', merged: true, specPath: undefined }));
      // toStrictEqual (not toEqual) so a `spec_path: undefined` key — what the `if(specPath !==
      // undefined)` guard would wrongly add if it always ran — is caught as a difference.
      expect(plan).toStrictEqual({
        target: 'story',
        updates: { factory_state: 'ready_for_dev' },
        snapshotSpec: true,
      });
    });

    it('closed & unmerged → reverts to needs_refinement', () => {
      const plan = planTransition(event({ action: 'closed', merged: false }));
      expect(plan).toEqual({
        target: 'story',
        updates: { factory_state: 'needs_refinement' },
        snapshotSpec: false,
      });
    });
  });

  describe('epic-refinement phase', () => {
    it('opened → records refinement_pr_url on the EPIC, no state, no snapshot', () => {
      const plan = planTransition(
        event({ phase: 'epic-refinement', action: 'opened', prUrl: 'https://x/pr/12' }),
      );
      // toStrictEqual so a stray `factory_state` key is caught — epics have no lifecycle.
      expect(plan).toStrictEqual({
        target: 'epic',
        updates: { refinement_pr_url: 'https://x/pr/12' },
        snapshotSpec: false,
      });
    });

    it('closed & merged → records spec_path on the EPIC and snapshots it', () => {
      const plan = planTransition(
        event({
          phase: 'epic-refinement',
          action: 'closed',
          merged: true,
          specPath: 'docs/specs/epics/ALF-12.html',
        }),
      );
      expect(plan).toStrictEqual({
        target: 'epic',
        updates: { spec_path: 'docs/specs/epics/ALF-12.html' },
        snapshotSpec: true,
      });
    });

    it('closed & merged without a spec-path still snapshots nothing extra', () => {
      const plan = planTransition(
        event({ phase: 'epic-refinement', action: 'closed', merged: true, specPath: undefined }),
      );
      expect(plan).toStrictEqual({ target: 'epic', updates: {}, snapshotSpec: true });
    });

    it('closed & UNMERGED is a no-op — an epic has no state to revert', () => {
      expect(
        planTransition(event({ phase: 'epic-refinement', action: 'closed', merged: false })),
      ).toBeUndefined();
    });

    it('never sets factory_state on any epic plan', () => {
      const plans = [
        planTransition(event({ phase: 'epic-refinement', action: 'opened' })),
        planTransition(event({ phase: 'epic-refinement', action: 'closed', merged: true })),
      ];
      for (const plan of plans) {
        expect(plan?.updates.factory_state).toBeUndefined();
      }
    });
  });

  describe('implementation phase', () => {
    it('opened → ready_for_review, records implementation_pr_url', () => {
      const plan = planTransition(
        event({ phase: 'implementation', action: 'opened', prUrl: 'https://x/pr/9' }),
      );
      expect(plan).toEqual({
        target: 'story',
        updates: { factory_state: 'ready_for_review', implementation_pr_url: 'https://x/pr/9' },
        snapshotSpec: false,
      });
    });

    it('closed & merged → done', () => {
      const plan = planTransition(
        event({ phase: 'implementation', action: 'closed', merged: true }),
      );
      expect(plan).toEqual({
        target: 'story',
        updates: { factory_state: 'done' },
        snapshotSpec: false,
      });
    });

    it('closed & unmerged → reverts to ready_for_dev', () => {
      const plan = planTransition(
        event({ phase: 'implementation', action: 'closed', merged: false }),
      );
      expect(plan).toEqual({
        target: 'story',
        updates: { factory_state: 'ready_for_dev' },
        snapshotSpec: false,
      });
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
