'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { CardChip } from '@/components/atoms/card-chip';
import { Spinner } from '@/components/atoms/spinner';
import { LAUNCH_LABELS, type LaunchPhase } from '@/lib/code/launch';
import type { CodeStory } from '@/lib/types';

export interface LaunchButtonProperties {
  /** The story to launch. */
  story: CodeStory;
  /**
   * The launch phase this button starts. Passed explicitly by the caller (the card/modal map
   * over `launchPhasesFor`) so one story can render more than one launch button — this atom owns
   * the launch contract and the `LAUNCH_LABELS` lookup, not the phase derivation.
   */
  phase: LaunchPhase;
  /**
   * Opens a prefilled Claude Code session for the given phase. Awaited so the in-flight
   * spinner reflects the real state write; on success the story usually leaves the launch-
   * eligible state and the button unmounts, so the flag is only cleared on failure.
   */
  onOpenSession?: ((story: CodeStory, phase: LaunchPhase) => void | Promise<void>) | undefined;
  /**
   * `chip` — the compact bordered chip on a story card.
   * `solid` — the prominent button in the story-detail modal header.
   */
  variant?: 'chip' | 'solid';
}

/**
 * The "Open Claude Code" launch action, shared by the story card (`chip`) and the detail
 * modal (`solid`). Owns the launch contract once — the await-spinner in-flight state — so both
 * presentations stay in sync; only the chrome differs by `variant`.
 *
 * The `bypass` ("Skip to Development") phase gets a deliberately SUBORDINATE treatment so the
 * primary "Refine in Claude Code" stays the obvious call to action: a muted/neutral chip rather
 * than the teal accent, and an `outline` button rather than the solid accent.
 */
export function LaunchButton({
  story,
  phase,
  onOpenSession,
  variant = 'chip',
}: LaunchButtonProperties) {
  const [launching, setLaunching] = React.useState(false);
  const labels = LAUNCH_LABELS[phase];
  const isSecondary = phase === 'bypass';

  const handleLaunch = async () => {
    if (onOpenSession === undefined) return;
    setLaunching(true);
    try {
      await onOpenSession(story, phase);
      // On success the store moves the story out of the launch-eligible state; the card/
      // modal unmounts, so we don't clear the flag (avoids setState-after-unmount).
    } catch {
      setLaunching(false);
    }
  };

  if (variant === 'solid') {
    return (
      <Button
        size="sm"
        variant={isSecondary ? 'outline' : 'accent'}
        onClick={() => {
          void handleLaunch();
        }}
        disabled={launching}
      >
        {launching ? <Spinner size={13} label={labels.busy} className="mr-1.5" /> : null}
        {labels.idle}
      </Button>
    );
  }

  return (
    <CardChip
      tone={isSecondary ? 'subordinate' : 'accent'}
      onClick={() => {
        void handleLaunch();
      }}
      disabled={launching}
    >
      {launching ? <Spinner size={12} label={labels.busy} /> : null}
      {labels.idle}
    </CardChip>
  );
}
