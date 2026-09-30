'use client';

import { ArrowDownToLine, ArrowUpToLine, ChevronsDown, ChevronsUp } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { useCodeActions, useStoryRankFlags } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

/** One jump — the Backlog's icon for that scope, its label, and its already-there state. */
export interface Jump {
  label: string;
  title: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}

/**
 * The four Backlog jumps a story can make — top/bottom of this story's own PROJECT (the midpoint
 * re-rank that leaves other projects undisturbed) and top/bottom of the WHOLE Backlog. The
 * Backlog's neighbour swap has no counterpart here: it needs the visible row above/below, which
 * only a rendered list knows.
 *
 * Reuses the row's icons and the same store actions, so a jump re-ranks the story in the store
 * immediately (the jumps re-derive from that new position) and the store's priority queue syncs it
 * — a rapid burst still costs one request. A jump the story already satisfies is disabled, read
 * from `useStoryRankFlags`. One list behind two presentations — the desktop buttons and the
 * phone's menu — so labels, icons and commits can't drift between layouts.
 *
 * Must be mounted under a `CodeProvider`.
 */
export function usePriorityJumps(story: CodeStory): Jump[] {
  const { moveStoryInProject, moveStory } = useCodeActions();
  const { isProjectTop, isProjectBottom, isBacklogTop, isBacklogBottom } = useStoryRankFlags(story);

  const storyRef = story.ref;
  const moveInProject = (toTop: boolean) => {
    if (storyRef !== null) moveStoryInProject(storyRef, toTop);
  };
  const move = (toTop: boolean) => {
    if (storyRef !== null) moveStory(storyRef, toTop);
  };

  return [
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
}

/** The story detail modal's priority controls: one labelled button per jump (see above). */
export function PriorityControls({ story }: { story: CodeStory }) {
  const jumps = usePriorityJumps(story);

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
