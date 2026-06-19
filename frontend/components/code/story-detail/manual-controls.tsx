'use client';

import { Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { TextareaField } from '@/components/atoms/textarea-field';
import { neighbourState, stateLabel } from '@/components/code/story-detail/state-helpers';
import { useCodeActions } from '@/lib/stores/code-store';
import type { CodeFactoryState, CodeStory } from '@/lib/types';

/** The manual fallback controls — Block (with reason), Abandon, Advance/Revert. */
export function ManualControls({ story }: { story: CodeStory }) {
  const { updateCodeState } = useCodeActions();
  const ref = story.ref;
  const state = story.factory_state;
  const [pending, setPending] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [reason, setReason] = React.useState(story.blocked_reason ?? '');

  const advanceTo = neighbourState(state, 'advance');
  const revertTo = neighbourState(state, 'revert');

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
        <Button
          variant="outline"
          size="sm"
          disabled={pending || revertTo === undefined}
          onClick={() => {
            if (revertTo !== undefined) void run(revertTo);
          }}
        >
          <ChevronLeft size={14} className="mr-1" />
          {revertTo === undefined ? 'Revert' : `Revert to ${stateLabel(revertTo)}`}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || advanceTo === undefined}
          onClick={() => {
            if (advanceTo !== undefined) void run(advanceTo);
          }}
        >
          {advanceTo === undefined ? 'Advance' : `Advance to ${stateLabel(advanceTo)}`}
          <ChevronRight size={14} className="ml-1" />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
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
