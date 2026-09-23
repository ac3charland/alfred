'use client';

import { Check, Circle } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { StateChip } from '@/components/code/state-chip';
import { DueDateChip } from '@/components/tasks/due-date-chip';
import { PriorityChip } from '@/components/tasks/priority-chip';
import { TypeGlyph } from '@/components/tasks/type-glyph';
import { useIndentation } from '@/lib/hooks/use-indentation';
import { useWeeklyPlanItems } from '@/lib/hooks/use-weekly-plan-items';
import { ALL_FACTORY_STATES } from '@/lib/stores/code-store';
import type { CodeFactoryState } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { WeeklyPlanItemCounts, WeeklyPlanItemNode } from '@/lib/weekly-plan-items/payload';

/**
 * The Week Plan view's second half (ALF-235): the tasks and code stories a review created
 * against the plan showing above it, read back through `useWeeklyPlanItems` — the same cohort
 * `create_weekly_plan_items` wrote and `GET /api/weekly-plans/[id]/items` answers with (ALF-195).
 *
 * Read-only by design, like the epic spec modal: editing a row (completing it, re-prioritising
 * it) belongs to the Inbox/folder/Backlog views that already own that row's write path, not to
 * a summary of what a past review committed to.
 */

/** Every genuine factory state, for telling one apart from `deriveCompletion`'s one sentinel
 * outside the enum — `'active'`, a planned code item that hasn't entered the factory yet. */
const FACTORY_STATES: ReadonlySet<string> = new Set(ALL_FACTORY_STATES);

function isCodeFactoryState(state: string): state is CodeFactoryState {
  return FACTORY_STATES.has(state);
}

/** "5 of 8 done", plus the abandoned count when there is one — the two questions the cohort
 * exists to answer at a glance (a done count with abandoned folded in would overstate it). */
function countsLabel(counts: WeeklyPlanItemCounts): string {
  const base = `${String(counts.done)} of ${String(counts.total)} done`;
  return counts.abandoned > 0 ? `${base} · ${String(counts.abandoned)} abandoned` : base;
}

function WeeklyPlanItemRow({ node, depth }: { node: WeeklyPlanItemNode; depth: number }) {
  const { rowLeft } = useIndentation(depth);

  return (
    <li>
      <div className="flex items-center gap-2 py-1.5 pr-3" style={{ paddingLeft: rowLeft }}>
        {/* `role="img"` is what makes the label a real accessible name — a bare span's
            `aria-label` isn't exposed, and the glyph inside carries no text of its own (the
            `ClassificationMark` convention). */}
        <span role="img" aria-label={node.done ? 'Done' : 'Open'} className="inline-flex shrink-0">
          {node.done ? (
            <Check size={14} strokeWidth={2.5} className="text-accent-teal" aria-hidden="true" />
          ) : (
            <Circle size={14} className="text-muted-foreground/40" aria-hidden="true" />
          )}
        </span>

        <TypeGlyph
          itemType={node.item_type}
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />

        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            node.done ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {node.title}
        </span>

        {node.code && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{node.code.ref}</span>
        )}

        {node.item_type === 'code' &&
          (isCodeFactoryState(node.state) ? (
            <StateChip state={node.state} />
          ) : (
            <Badge variant="muted" className="font-medium">
              Not started
            </Badge>
          ))}

        {node.due_date && <DueDateChip inert dueDate={node.due_date} />}
        {node.priority && <PriorityChip inert priority={node.priority} />}
      </div>

      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <WeeklyPlanItemRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function WeeklyPlanItems({ planId }: { planId: string }) {
  const state = useWeeklyPlanItems(planId);
  const headingId = React.useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        From this plan
      </h3>

      {state.status === 'loading' && (
        <div
          data-testid="weekly-plan-items-loading"
          className="h-5 w-40 animate-pulse rounded-full bg-border motion-reduce:animate-none"
        />
      )}

      {state.status === 'error' && (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this week&apos;s tasks.</p>
      )}

      {state.status === 'ready' &&
        (state.payload.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been created from this plan yet.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{countsLabel(state.payload.counts)}</p>
            <ul
              aria-label="Tasks and code stories from this plan"
              className="flex flex-col divide-y divide-border/60 rounded-md border border-border/60"
            >
              {state.payload.items.map((node) => (
                <WeeklyPlanItemRow key={node.id} node={node} depth={0} />
              ))}
            </ul>
          </>
        ))}
    </section>
  );
}
