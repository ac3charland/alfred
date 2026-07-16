'use client';

import { UserCheck } from 'lucide-react';
import * as React from 'react';

import { BacklogList } from '@/components/code/backlog/backlog-list';
import { HUMAN_REVIEW_STATUSES, useBacklog } from '@/lib/stores/code-store';

/**
 * The "Needs human action" view (`/code/needs-human-action`) — a focused, cross-project queue of
 * every story awaiting the owner's eyes: a spec in review (`in_refinement`) and the two ready-for
 * gates (`ready_for_dev`, `ready_for_review`). Promoted from the Backlog's old "Human Review"
 * filter macro (ALF-103) into its own sidebar destination, so the states that need a human are one
 * click away rather than buried in a filter preset.
 *
 * It reuses the Backlog's ranked, reorderable `BacklogList` with a FIXED status set (no filter
 * menu — the view itself IS the filter). `HUMAN_REVIEW_STATUSES` is a module constant, so it's
 * referentially stable and `useBacklog`'s memo only recomputes when the story slice changes.
 *
 * Must be mounted under a `CodeProvider` (reads `useBacklog`; `BacklogList` reads the actions).
 */
export function NeedsHumanAction() {
  const stories = useBacklog({ statuses: HUMAN_REVIEW_STATUSES });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-accent-teal">
          <UserCheck size={20} />
        </div>
        <div className="flex flex-col">
          <h2 className="font-serif text-2xl text-foreground">Needs human action</h2>
          <p className="text-sm text-muted-foreground">
            Stories waiting on your review — a spec to approve or a gate to clear.
          </p>
        </div>
      </div>

      <BacklogList
        stories={stories}
        emptyMessage="Nothing needs your attention right now. Stories waiting on a spec review or a ready-for gate will appear here."
      />
    </div>
  );
}
