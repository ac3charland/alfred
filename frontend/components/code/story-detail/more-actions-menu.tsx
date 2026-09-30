'use client';

import { Ban, CircleCheck, Ellipsis } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import type { StoryTransitions } from '@/components/code/story-detail/manual-controls';
import { useRefinementMark } from '@/components/code/story-detail/refinement-mark';
import { stateLabel } from '@/components/code/story-detail/state-helpers';
import { LAUNCH_LABELS, type LaunchPhase, launchPhasesFor } from '@/lib/code/launch';
import { storyKindOf } from '@/lib/code/story-kind';
import type { CodeStory } from '@/lib/types';

const AMBER_ITEM = 'text-amber-400 focus:text-amber-400';

/**
 * The phone's ⋯ menu: the rarer actions the action bar has no room for, each one a tap deeper
 * than the desktop's button.
 *
 * - **Skip to dev**, on a needs-refinement story: the secondary launch, subordinate to Refine.
 * - **Needs refinement**, a checkbox item, on a story that can be refined — a spike or a bug never
 *   is, so the item is absent rather than disabled.
 * - **Block…** (opens the reason editor) or, on a blocked story, **Unblock to <lane>**.
 * - **Abandon**, unless it already is.
 *
 * A divider separates the first two (properties of the story) from the last two (moves), and is
 * absent when there is nothing above it.
 */
export function MoreActionsMenu({
  story,
  transitions,
  onBlock,
  onOpenSession,
}: {
  story: CodeStory;
  transitions: StoryTransitions;
  /** Open the block-reason editor. */
  onBlock: () => void;
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}) {
  const state = story.factory_state;
  const mark = useRefinementMark(story);
  const { pending } = transitions;

  const canSkipToDev = launchPhasesFor(story).includes('bypass');
  const canRefine = storyKindOf(story) === 'story';
  // Picking Block… opens an editor that takes focus. Radix would then hand focus back to this
  // menu's trigger as it closes, stealing it from the editor (and dropping the keyboard).
  const openedEditor = React.useRef(false);

  const skipToDev = async () => {
    try {
      await onOpenSession(story, 'bypass');
    } catch {
      // The launch reports its own failure; the menu has nothing to roll back.
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="More story actions"
          className="w-8 shrink-0 px-0"
        >
          <Ellipsis size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!openedEditor.current) return;
          event.preventDefault();
          openedEditor.current = false;
        }}
      >
        {canSkipToDev ? (
          <DropdownMenuItem
            onSelect={() => {
              void skipToDev();
            }}
          >
            {LAUNCH_LABELS.bypass.short}
          </DropdownMenuItem>
        ) : null}
        {canRefine ? (
          <DropdownMenuCheckboxItem
            checked={mark.checked}
            disabled={mark.disabled}
            onCheckedChange={(next) => {
              void mark.toggle(next);
            }}
          >
            Needs refinement
          </DropdownMenuCheckboxItem>
        ) : null}
        {canSkipToDev || canRefine ? <DropdownMenuSeparator /> : null}
        {state === 'blocked' ? (
          <DropdownMenuItem
            disabled={pending}
            className={AMBER_ITEM}
            onSelect={transitions.unblock}
          >
            <CircleCheck size={14} />
            {`Unblock to ${stateLabel(transitions.unblockTo)}`}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={pending}
            className={AMBER_ITEM}
            onSelect={() => {
              openedEditor.current = true;
              onBlock();
            }}
          >
            <Ban size={14} />
            Block…
          </DropdownMenuItem>
        )}
        {state === 'abandoned' ? null : (
          <DropdownMenuItem variant="destructive" disabled={pending} onSelect={transitions.abandon}>
            Abandon
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
