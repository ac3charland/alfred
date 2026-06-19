'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Spinner } from '@/components/atoms/spinner';
import { LAUNCH_LABELS, type LaunchPhase, launchPhaseFor } from '@/lib/code/launch';
import type { CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface LaunchButtonProperties {
  /** The story to launch. Its `factory_state` decides the phase (refine / implement). */
  story: CodeStory;
  /**
   * Opens a prefilled Claude Code session for the story's phase. Awaited so the in-flight
   * spinner reflects the real state write; on success the story usually leaves the launch-
   * eligible state and the button unmounts, so the flag is only cleared on failure.
   */
  onOpenSession?: ((story: CodeStory, phase: LaunchPhase) => void | Promise<void>) | undefined;
  /**
   * `chip` — the compact teal-bordered chip on a story card.
   * `solid` — the prominent solid-accent button in the story-detail modal header.
   */
  variant?: 'chip' | 'solid';
}

/**
 * The "Open Claude Code" launch action, shared by the story card (`chip`) and the detail
 * modal (`solid`). Owns the launch contract once — the phase derivation and the
 * await-spinner in-flight state — so both presentations stay in sync; only the chrome
 * differs by `variant`. Renders nothing when the story's state offers no launch.
 */
export function LaunchButton({ story, onOpenSession, variant = 'chip' }: LaunchButtonProperties) {
  const phase = launchPhaseFor(story.factory_state);
  const [launching, setLaunching] = React.useState(false);
  if (phase === undefined) return null;
  const labels = LAUNCH_LABELS[phase];

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
        variant="accent"
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
    <button
      type="button"
      onClick={() => {
        void handleLaunch();
      }}
      disabled={launching}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-accent-teal/40 bg-accent-teal/10 px-2 py-1 text-xs font-medium text-accent-teal',
        'transition-colors duration-100 hover:bg-accent-teal/20 motion-reduce:transition-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
        'disabled:cursor-not-allowed disabled:opacity-70',
      )}
    >
      {launching ? <Spinner size={12} label={labels.busy} /> : null}
      {labels.idle}
    </button>
  );
}
