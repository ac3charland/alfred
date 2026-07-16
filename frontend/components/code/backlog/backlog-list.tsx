'use client';

import * as React from 'react';

import { BacklogRow } from '@/components/code/backlog/backlog-row';
import { projectColorFor } from '@/lib/code/project-color';
import { useFlipList } from '@/lib/hooks/use-flip-list';
import { useCodeActions, useProjects } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

interface BacklogListProperties {
  /** The stories to render, already filtered and in the order they should appear. */
  stories: CodeStory[];
  /** Shown in place of the list when `stories` is empty. */
  emptyMessage: React.ReactNode;
}

/**
 * The shared, reorderable story list behind both the Backlog and the Needs-human-action view: one
 * `BacklogRow` per story in the given order, wired to the CodeProvider reorder/move actions and
 * FLIP-animated (honouring `prefers-reduced-motion`). The single chevrons swap a story with its
 * visible neighbour; the double chevrons jump it to the top/bottom of ITS OWN PROJECT; the
 * arrow-to-line icons jump it to the top/bottom of the WHOLE Backlog — all acting on global
 * `priority` over whatever rows are currently shown, so the semantics hold whether the caller
 * passes the Backlog's filtered selection or the Needs-human-action view's fixed states.
 *
 * The caller owns which `stories` to pass and the `emptyMessage`. Must be mounted under a
 * `CodeProvider` (reads `useProjects` / `useCodeActions`).
 */
export function BacklogList({ stories, emptyMessage }: BacklogListProperties) {
  const projects = useProjects();
  const {
    applyReorderOptimistic,
    commitReorderBatch,
    applyMoveInProjectOptimistic,
    commitMoveInProject,
    applyMoveOptimistic,
    commitMove,
  } = useCodeActions();

  // Each project's best/worst priority among the CURRENTLY LISTED stories (ALF-110), so the
  // double-chevron "to top/bottom of project" disables once a story already holds that slot.
  const projectBounds = React.useMemo(() => {
    const bounds = new Map<string, { min: number; max: number }>();
    for (const story of stories) {
      if (story.project_id === null || story.priority === null) continue;
      const current = bounds.get(story.project_id);
      bounds.set(story.project_id, {
        min: current === undefined ? story.priority : Math.min(current.min, story.priority),
        max: current === undefined ? story.priority : Math.max(current.max, story.priority),
      });
    }
    return bounds;
  }, [stories]);

  // Animate the reorder: FLIP keyed by item_id over the currently rendered order.
  const registerRow = useFlipList(stories.map((story) => story.item_id ?? ''));

  if (stories.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10">
        <p className="max-w-sm text-center text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {stories.map((story, index) => {
        const bounds = story.project_id === null ? undefined : projectBounds.get(story.project_id);
        return (
          <BacklogRow
            key={story.item_id}
            ref={registerRow(story.item_id ?? '')}
            story={story}
            projectColor={projectColorFor(projects, story.project_id)}
            prevRef={index === 0 ? null : (stories[index - 1]?.ref ?? null)}
            nextRef={index === stories.length - 1 ? null : (stories[index + 1]?.ref ?? null)}
            isProjectTop={bounds === undefined || story.priority === bounds.min}
            isProjectBottom={bounds === undefined || story.priority === bounds.max}
            applyReorder={applyReorderOptimistic}
            commitReorder={commitReorderBatch}
            applyMoveInProject={applyMoveInProjectOptimistic}
            commitMoveInProject={commitMoveInProject}
            applyMove={applyMoveOptimistic}
            commitMove={commitMove}
          />
        );
      })}
    </ul>
  );
}
