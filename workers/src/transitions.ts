/**
 * The PR → ticket state machine.
 *
 * Pure logic, no I/O: given the `(phase, action, merged)` of a `pull_request` webhook, decide
 * which table's columns to patch (`code_items` for a story, `epics` for an epic spec) and whether
 * to snapshot the spec. Because both story lifecycle phases end in a PR, this table is the whole
 * system's clock — every transition row lives here so it can be unit-tested exhaustively.
 */
import type { CodePhase } from './frontmatter';

export type FactoryState =
  | 'needs_refinement'
  | 'in_refinement'
  | 'ready_for_dev'
  | 'in_development'
  | 'ready_for_review'
  | 'done'
  | 'blocked'
  | 'abandoned';

/** The fields of a `pull_request` event the transition decision depends on. */
export interface PrEvent {
  phase: CodePhase;
  /** The webhook `action` (`opened`, `closed`, `edited`, `synchronize`, …). */
  action: string;
  /** `pull_request.merged` — only meaningful when `action === 'closed'`. */
  merged: boolean;
  prUrl: string;
  /** `spec-path` from the frontmatter (refinement + spike PRs); `undefined` otherwise. */
  specPath: string | undefined;
}

/**
 * The column updates to PATCH onto a `code_items` OR an `epics` row (only set keys are written).
 * The two tables share the spec/PR column names deliberately, so an epic plan reuses this type —
 * it only ever sets `refinement_pr_url` / `spec_path`, both of which exist on `epics` too.
 */
export interface TicketUpdate {
  factory_state?: FactoryState;
  refinement_pr_url?: string;
  implementation_pr_url?: string;
  spec_path?: string;
}

/**
 * Which table a plan patches. Routing is EXPLICIT, keyed off the phase — refs come from one
 * shared per-project counter, so a "try code_items, fall back to epics" scheme would make a
 * typo'd story ref silently patch nothing while looking like it worked.
 */
export type TransitionTarget = 'story' | 'epic';

/** The decision for one PR event: which table, columns to patch + whether to snapshot the spec. */
export interface TransitionPlan {
  target: TransitionTarget;
  updates: TicketUpdate;
  snapshotSpec: boolean;
}

/**
 * Map a PR event to its transition plan, or `undefined` when the event is a no-op for us
 * (any action other than `opened` / `closed` — e.g. `edited`, `synchronize`, `reopened`).
 *
 * The transition table, verbatim:
 *   epic-refinement+ opened          → (epics) record refinement_pr_url
 *   epic-refinement+ closed & merged → (epics) record spec_path; snapshot spec
 *   epic-refinement+ closed & !merged→ no-op (an epic has no state to revert)
 *   refinement     + opened          → no state change; record refinement_pr_url
 *   refinement     + closed & merged → ready_for_dev; record spec_path; snapshot spec
 *   refinement     + closed & !merged→ needs_refinement (revert; abandon is manual)
 *   implementation + opened          → ready_for_review; record implementation_pr_url
 *   implementation + closed & merged → done
 *   implementation + closed & !merged→ ready_for_dev (revert)
 *   spike          + opened          → ready_for_review; record implementation_pr_url
 *   spike          + closed & merged → done; record spec_path; snapshot findings
 *   spike          + closed & !merged→ ready_for_dev (revert; the button is offered again)
 */
export function planTransition(event: PrEvent): TransitionPlan | undefined {
  const { phase, action, merged, prUrl, specPath } = event;

  if (phase === 'epic-refinement') {
    // Epics carry NO lifecycle state, so an epic plan only ever records the PR url or the
    // spec — never a factory_state — and a closed-unmerged PR has nothing to undo.
    if (action === 'opened') {
      return { target: 'epic', updates: { refinement_pr_url: prUrl }, snapshotSpec: false };
    }
    if (action === 'closed' && merged) {
      const updates: TicketUpdate = {};
      if (specPath !== undefined) updates.spec_path = specPath;
      return { target: 'epic', updates, snapshotSpec: true };
    }
    return undefined;
  }

  if (phase === 'refinement') {
    if (action === 'opened') {
      // A refinement PR opening is a no-op for the state machine — just record the URL.
      return { target: 'story', updates: { refinement_pr_url: prUrl }, snapshotSpec: false };
    }
    if (action === 'closed') {
      if (merged) {
        const updates: TicketUpdate = { factory_state: 'ready_for_dev' };
        if (specPath !== undefined) updates.spec_path = specPath;
        return { target: 'story', updates, snapshotSpec: true };
      }
      return {
        target: 'story',
        updates: { factory_state: 'needs_refinement' },
        snapshotSpec: false,
      };
    }
    return undefined;
  }

  if (phase === 'spike') {
    // A spike is ONE session that both answers the question and writes the findings, so it
    // reuses the existing states: the PR opening parks the story in review (the Review PR chip
    // links it, exactly as for an implementation PR), merging finishes it, and a closed-unmerged
    // PR reverts to ready_for_dev — where the spike button is offered again, the retry path.
    if (action === 'opened') {
      return {
        target: 'story',
        updates: { factory_state: 'ready_for_review', implementation_pr_url: prUrl },
        snapshotSpec: false,
      };
    }
    if (action === 'closed') {
      if (merged) {
        // MERGE is the snapshot point, not open: unlike implementation (whose spec was recorded
        // a phase earlier) a spike's document only exists on its own PR, so the path is recorded
        // and the file snapshotted here — through the same spec columns any story document uses.
        const updates: TicketUpdate = { factory_state: 'done' };
        if (specPath !== undefined) updates.spec_path = specPath;
        return { target: 'story', updates, snapshotSpec: true };
      }
      return { target: 'story', updates: { factory_state: 'ready_for_dev' }, snapshotSpec: false };
    }
    return undefined;
  }

  // phase === 'implementation'
  if (action === 'opened') {
    return {
      target: 'story',
      updates: { factory_state: 'ready_for_review', implementation_pr_url: prUrl },
      snapshotSpec: false,
    };
  }
  if (action === 'closed') {
    return {
      target: 'story',
      updates: { factory_state: merged ? 'done' : 'ready_for_dev' },
      snapshotSpec: false,
    };
  }
  return undefined;
}
