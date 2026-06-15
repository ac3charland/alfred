/**
 * The PR → ticket state machine (code-module §5.2 / §13.2).
 *
 * Pure logic, no I/O: given the `(phase, action, merged)` of a `pull_request` webhook, decide
 * which `code_items` columns to patch and whether to snapshot the spec. Because both lifecycle
 * phases end in a PR, this table is the whole system's clock — every transition row lives here so
 * it can be unit-tested exhaustively (§13.4).
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
  /** `spec-path` from the frontmatter (refinement PRs); `undefined` otherwise. */
  specPath: string | undefined;
}

/** The column updates to PATCH onto a `code_items` row (only set keys are written). */
export interface TicketUpdate {
  factory_state?: FactoryState;
  refinement_pr_url?: string;
  implementation_pr_url?: string;
  spec_path?: string;
}

/** The decision for one PR event: columns to patch + whether to snapshot the spec (§13.3). */
export interface TransitionPlan {
  updates: TicketUpdate;
  snapshotSpec: boolean;
}

/**
 * Map a PR event to its transition plan, or `undefined` when the event is a no-op for us
 * (any action other than `opened` / `closed` — e.g. `edited`, `synchronize`, `reopened`).
 *
 * The §13.2 table, verbatim:
 *   refinement     + opened          → no state change; record refinement_pr_url
 *   refinement     + closed & merged → ready_for_dev; record spec_path; snapshot spec
 *   refinement     + closed & !merged→ needs_refinement (revert; abandon is manual)
 *   implementation + opened          → ready_for_review; record implementation_pr_url
 *   implementation + closed & merged → done
 *   implementation + closed & !merged→ ready_for_dev (revert)
 */
export function planTransition(event: PrEvent): TransitionPlan | undefined {
  const { phase, action, merged, prUrl, specPath } = event;

  if (phase === 'refinement') {
    if (action === 'opened') {
      // A refinement PR opening is a no-op for the state machine (§5.3) — just record the URL.
      return { updates: { refinement_pr_url: prUrl }, snapshotSpec: false };
    }
    if (action === 'closed') {
      if (merged) {
        const updates: TicketUpdate = { factory_state: 'ready_for_dev' };
        if (specPath !== undefined) updates.spec_path = specPath;
        return { updates, snapshotSpec: true };
      }
      return { updates: { factory_state: 'needs_refinement' }, snapshotSpec: false };
    }
    return undefined;
  }

  // phase === 'implementation'
  if (action === 'opened') {
    return {
      updates: { factory_state: 'ready_for_review', implementation_pr_url: prUrl },
      snapshotSpec: false,
    };
  }
  if (action === 'closed') {
    return {
      updates: { factory_state: merged ? 'done' : 'ready_for_dev' },
      snapshotSpec: false,
    };
  }
  return undefined;
}
