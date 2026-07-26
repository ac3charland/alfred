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
import { HAPPY_PATH_STATES, STATE_LABELS, useCodeActions } from '@/lib/stores/code-store';
import type { CodeFactoryState, CodeStory } from '@/lib/types';

/**
 * The status picker: an outline trigger showing the story's current status over a menu of every
 * happy-path lane in board order, check-marking the one it's in. Any lane is one pick away — so a
 * story can jump several lanes at once, and a blocked/abandoned one (which has no lane, hence no
 * check mark) can be dropped straight back onto the board.
 */
function StatusMenu({
  state,
  disabled,
  onPick,
}: {
  state: CodeFactoryState | null;
  disabled: boolean;
  onPick: (next: CodeFactoryState) => void;
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
          className="gap-1.5"
        >
          {stateLabel(state)}
          <ChevronDown size={14} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {HAPPY_PATH_STATES.map((option) => (
          <DropdownMenuItem
            key={option}
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

/** The manual fallback controls — the status dropdown, Block (with reason), Unblock, Abandon. */
export function ManualControls({ story }: { story: CodeStory }) {
  const { updateCodeState } = useCodeActions();
  const ref = story.ref;
  const state = story.factory_state;
  const [pending, setPending] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [reason, setReason] = React.useState(story.blocked_reason ?? '');

  const unblockTo = story.blocked_from ?? HAPPY_PATH_STATES[0];

  const run = async (next: CodeFactoryState, extra?: { blocked_reason?: string | null }) => {
    if (ref === null) return;
    setPending(true);
    try {
      await updateCodeState(ref, next, extra);
      setBlockOpen(false);
    } catch {
      // The store rolled the state back.
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Move this story
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <StatusMenu
          state={state}
          disabled={pending}
          onPick={(next) => {
            // Leaving `blocked` must clear the reason with the same write: the PATCH route only
            // forwards `blocked_reason` when the body carries the key, so omitting it here would
            // strand the old reason on a story that is no longer blocked.
            void run(next, state === 'blocked' ? { blocked_reason: null } : undefined);
          }}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        {/* Unblock is the one-click way back out: the dropdown can send a blocked story to ANY
            lane, but only this knows which one it came FROM — `blocked_from`, or the first state
            for a row blocked before that was recorded — and it clears the reason along with it. */}
        {state === 'blocked' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              void run(unblockTo, { blocked_reason: null });
            }}
            className="border-amber-500/50 text-amber-400 hover:border-amber-500"
          >
            <CircleCheck size={14} className="mr-1" />
            {`Unblock to ${stateLabel(unblockTo)}`}
          </Button>
        ) : null}
        {state === 'blocked' ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setReason(story.blocked_reason ?? '');
              setBlockOpen((on) => !on);
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
            onClick={() => {
              void run('abandoned');
            }}
            className="border-destructive/50 text-destructive hover:border-destructive"
          >
            Abandon
          </Button>
        )}
      </div>

      {blockOpen ? (
        <TextareaField
          variant="warning"
          label="Why is this blocked? (optional)"
          value={reason}
          onChange={setReason}
          onSave={() => {
            const trimmed = reason.trim();
            void run('blocked', { blocked_reason: trimmed === '' ? null : trimmed });
          }}
          onCancel={() => {
            setBlockOpen(false);
          }}
          placeholder="e.g. waiting on an upstream API decision"
          isPending={pending}
          saveLabel="Confirm block"
        />
      ) : null}
    </div>
  );
}
