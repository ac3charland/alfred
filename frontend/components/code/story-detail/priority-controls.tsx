'use client';

import { ArrowDownToLine, ArrowUpToLine, ChevronsDown, ChevronsUp } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { useMoveBurst } from '@/lib/hooks/use-move-burst';
import { useCodeActions, useStoryRankFlags } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

/** One jump button — the Backlog's icon for that scope, its label, and its already-there state. */
interface Jump {
  label: string;
  title: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}

/**
 * The story detail modal's priority controls: the same four Backlog jumps a row exposes through
 * its chevron pairs — top/bottom of this story's own PROJECT (the midpoint re-rank that leaves
 * other projects undisturbed) and top/bottom of the WHOLE Backlog — so a story can be reprioritised
 * without leaving the board. The Backlog's neighbour swap has no counterpart here: it needs the
 * visible row above/below, which only a rendered list knows.
 *
 * Reuses the row's icons and its instant-apply + debounced-commit `useMoveBurst`, so a click
 * re-ranks the story in the store immediately (the buttons re-derive from that new position) and
 * a rapid burst still costs one request. A jump the story already satisfies is disabled, read
 * from `useStoryRankFlags`.
 *
 * Must be mounted under a `CodeProvider`.
 */
export function PriorityControls({ story }: { story: CodeStory }) {
  const { applyMoveInProjectOptimistic, commitMoveInProject, applyMoveOptimistic, commitMove } =
    useCodeActions();
  const { isProjectTop, isProjectBottom, isBacklogTop, isBacklogBottom } = useStoryRankFlags(story);

  const moveInProject = useMoveBurst(story.ref, applyMoveInProjectOptimistic, commitMoveInProject);
  const move = useMoveBurst(story.ref, applyMoveOptimistic, commitMove);

  const jumps: Jump[] = [
    {
      label: 'Top of project',
      title: "Move to the top of this story's project",
      icon: <ChevronsUp size={14} />,
      disabled: isProjectTop,
      onClick: () => {
        moveInProject(true);
      },
    },
    {
      label: 'Bottom of project',
      title: "Move to the bottom of this story's project",
      icon: <ChevronsDown size={14} />,
      disabled: isProjectBottom,
      onClick: () => {
        moveInProject(false);
      },
    },
    {
      label: 'Top of backlog',
      title: 'Move to the top of the whole Backlog',
      icon: <ArrowUpToLine size={14} />,
      disabled: isBacklogTop,
      onClick: () => {
        move(true);
      },
    },
    {
      label: 'Bottom of backlog',
      title: 'Move to the bottom of the whole Backlog',
      icon: <ArrowDownToLine size={14} />,
      disabled: isBacklogBottom,
      onClick: () => {
        move(false);
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Priority
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        {jumps.map((jump) => (
          <Button
            key={jump.label}
            variant="outline"
            size="sm"
            title={jump.title}
            disabled={jump.disabled}
            onClick={jump.onClick}
          >
            {jump.icon}
            {jump.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
