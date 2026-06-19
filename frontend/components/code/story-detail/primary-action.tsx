'use client';

import { LaunchButton } from '@/components/atoms/launch-button';
import type { LaunchPhase } from '@/lib/code/launch';
import type { CodeStory } from '@/lib/types';

interface PrimaryActionProperties {
  story: CodeStory;
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}

/**
 * The primary "Open Claude Code" action in the story-detail modal header — the solid-accent
 * presentation of the shared {@link LaunchButton}. The launch contract (phase derivation +
 * await-spinner) lives in that atom, so the card and the modal stay in sync; only the chrome
 * differs (`solid` here vs the card's `chip`). Renders nothing outside the launch-eligible
 * states.
 */
export function PrimaryAction({ story, onOpenSession }: PrimaryActionProperties) {
  return <LaunchButton story={story} onOpenSession={onOpenSession} variant="solid" />;
}
