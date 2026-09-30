'use client';

import { Ban, Check, ChevronDown, CircleCheck } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { TextareaField } from '@/components/atoms/textarea-field';
import { stateLabel } from '@/components/code/story-detail/state-helpers';
import { canMoveToState } from '@/lib/code/refinement';
import { HAPPY_PATH_STATES, STATE_LABELS, useCodeActions } from '@/lib/stores/code-store';
import type { CodeFactoryState, CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The status picker: an outline trigger showing the story's current status over a menu of every
 * happy-path lane in board order, check-marking the one it's in. Any lane is one pick away — so a
 * story can jump several lanes at once, and a blocked/abandoned one (which has no lane, hence no
 * check mark) can be dropped straight back onto the board.
 *
 * Any lane the story's KIND cannot occupy is rendered disabled rather than hidden (ALF-215): a
 * bug and a spike are never refined, and a greyed-out "Needs Refinement" says that, where a menu
 * silently four items long would just look broken.
 */
export function StatusMenu({
  story,
  state,
  disabled,
  onPick,
  className,
}: {
  story: Pick<CodeStory, 'title'>;
  state: CodeFactoryState | null;
  disabled: boolean;
  onPick: (next: CodeFactoryState) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          // The visible label is the current status, so name the control's *purpose* for
          // assistive tech while still announcing where the story sits today.
          aria-label={`Change status (currently ${stateLabel(state)})`}
          className={cn('gap-1.5', className)}
        >
          {stateLabel(state)}
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {HAPPY_PATH_STATES.map((option) => (
          <DropdownMenuItem
            key={option}
            disabled={!canMoveToState(story, option)}
            aria-current={option === state ? 'true' : undefined}
            className="justify-between gap-6"
            onSelect={() => {
              // Re-picking the current status is a no-op, not a same-state write.
              if (option !== state) onPick(option);
            }}
          >
            {STATE_LABELS[option]}
            {option === state ? <Check size={12} className="text-accent-teal" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The story's state transitions and their in-flight guard, shared by the desktop's manual controls
 * and the phone's action bar and ⋯ menu so both write the same way. `onMoved` runs after a move
 * lands (the callers close the block-reason editor).
 */
export function useStoryTransitions(story: CodeStory, onMoved: () => void) {
  const { updateCodeState } = useCodeActions();
  const ref = story.ref;
  const state = story.factory_state;
  const [pending, setPending] = React.useState(false);

  /** Where Unblock goes: `blocked_from`, or the first state for a row blocked before it was recorded. */
  const unblockTo = story.blocked_from ?? HAPPY_PATH_STATES[0];

  const run = async (next: CodeFactoryState, extra?: { blocked_reason?: string | null }) => {
    if (ref === null) return;
    setPending(true);
    try {
      await updateCodeState(ref, next, extra);
      onMoved();
    } catch {
      // The store rolled the state back.
    } finally {
      setPending(false);
    }
  };

  return {
    pending,
    unblockTo,
    // Leaving `blocked` must clear the reason with the same write: the PATCH route only forwards
    // `blocked_reason` when the body carries the key, so omitting it here would strand the old
    // reason on a story that is no longer blocked.
    pickStatus: (next: CodeFactoryState) => {
      void run(next, state === 'blocked' ? { blocked_reason: null } : undefined);
    },
    // Unblock is the one-click way back out: the status menu can send a blocked story to ANY lane,
    // but only this knows which one it came FROM — and it clears the reason along with it.
    unblock: () => {
      void run(unblockTo, { blocked_reason: null });
    },
    abandon: () => {
      void run('abandoned');
    },
    confirmBlock: (reason: string) => {
      const trimmed = reason.trim();
      void run('blocked', { blocked_reason: trimmed === '' ? null : trimmed });
    },
  };
}

export type StoryTransitions = ReturnType<typeof useStoryTransitions>;

/**
 * The block-reason editor: an amber card holding a textarea and its Confirm/Cancel, opened by
 * Block. It starts from the story's recorded reason each time it opens (it mounts fresh).
 *
 * On a phone the sheet passes `autoGrow`, `actionsTarget` (the footer) and `reveal`: the card
 * grows with its text, its actions sit below the scrolling body instead of over it, and opening
 * it scrolls it into view and focuses it.
 */
export function BlockReasonEditor({
  story,
  pending,
  onConfirm,
  onCancel,
  autoGrow = false,
  actionsTarget,
  reveal = false,
}: {
  story: CodeStory;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  autoGrow?: boolean;
  actionsTarget?: Element | null | undefined;
  reveal?: boolean;
}) {
  const [reason, setReason] = React.useState(story.blocked_reason ?? '');
  const wrapper = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!reveal) return;
    const node = wrapper.current;
    // `scrollIntoView` is unimplemented under jsdom, so feature-detect it. `preventScroll` on the
    // focus: the card is already scrolled to, and a second scroll would only jump it.
    if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
    node?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [reveal]);

  return (
    <div ref={wrapper}>
      <TextareaField
        variant="warning"
        label="Why is this blocked? (optional)"
        value={reason}
        onChange={setReason}
        onSave={() => {
          onConfirm(reason);
        }}
        onCancel={onCancel}
        placeholder="e.g. waiting on an upstream API decision"
        isPending={pending}
        saveLabel="Confirm block"
        autoGrow={autoGrow}
        actionsTarget={actionsTarget}
      />
    </div>
  );
}

/**
 * The manual fallback controls — the status dropdown, Block (with reason), Unblock, Abandon.
 * The desktop card's version: on a phone the same transitions live in the action bar and ⋯ menu.
 * The block-reason editor's open state is the caller's, since the phone's Block… opens the card
 * somewhere other than beside its button.
 */
export function ManualControls({
  story,
  transitions,
  blockOpen,
  onBlockOpenChange,
}: {
  story: CodeStory;
  transitions: StoryTransitions;
  blockOpen: boolean;
  onBlockOpenChange: (open: boolean) => void;
}) {
  const state = story.factory_state;
  const { pending } = transitions;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Move this story
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <StatusMenu
          story={story}
          state={state}
          disabled={pending}
          onPick={transitions.pickStatus}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        {state === 'blocked' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={transitions.unblock}
            className="border-amber-500/50 text-amber-400 hover:border-amber-500"
          >
            <CircleCheck size={14} className="mr-1" />
            {`Unblock to ${stateLabel(transitions.unblockTo)}`}
          </Button>
        ) : null}
        {state === 'blocked' ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              onBlockOpenChange(!blockOpen);
            }}
            className="border-amber-500/50 text-amber-400 hover:border-amber-500"
          >
            <Ban size={14} className="mr-1" />
            Block
          </Button>
        )}
        {state === 'abandoned' ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={transitions.abandon}
            className="border-destructive/50 text-destructive hover:border-destructive"
          >
            Abandon
          </Button>
        )}
      </div>

      {blockOpen ? (
        <BlockReasonEditor
          story={story}
          pending={pending}
          onConfirm={transitions.confirmBlock}
          onCancel={() => {
            onBlockOpenChange(false);
          }}
        />
      ) : null}
    </div>
  );
}
