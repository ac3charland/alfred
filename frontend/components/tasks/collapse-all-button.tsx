'use client';

import { ChevronsDownUp } from 'lucide-react';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { useExpansion, useExpansionActions } from '@/lib/stores/expansion-store';
import type { TaskScope } from '@/lib/stores/tasks-store';
import { useScopedTasks } from '@/lib/stores/tasks-store';
import { getDescendantIds } from '@/lib/tree';

/**
 * One view's "collapse all" header affordance: closes every open subtask tree AND
 * "Show completed" panel in that view with a single click.
 *
 * Expansion is the shared ExpansionProvider's state, so this is a pure cross-row dispatch
 * — it reads the view's forest from the store, flattens it to the ids that view renders,
 * and calls `collapseAll(viewIds)`. Scoping to the view's ids means collapsing here leaves
 * other views' expansions intact. Disabled when the view has nothing open to collapse.
 */
export function CollapseAllButton({ scope }: { scope: TaskScope }) {
  const nodes = useScopedTasks(scope);
  const { subtasks, completed } = useExpansion();
  const { collapseAll } = useExpansionActions();

  // Every id rendered in this view: each root plus all its descendants. The scoped
  // selector keeps completed children in the active-view tree, so their panel ids are
  // covered here too.
  const viewIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const node of nodes) {
      ids.push(node.id, ...getDescendantIds(node));
    }
    return ids;
  }, [nodes]);

  const hasExpanded = viewIds.some((id) => subtasks.has(id) || completed.has(id));

  return (
    <IconButton
      size="md"
      aria-label="Collapse all"
      title="Collapse all"
      disabled={!hasExpanded}
      onClick={() => {
        collapseAll(viewIds);
      }}
    >
      <ChevronsDownUp size={16} />
    </IconButton>
  );
}
