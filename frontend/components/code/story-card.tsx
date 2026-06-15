'use client';

import * as React from 'react';

import { isEscapeState } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface StoryCardProperties {
  /** The flattened code-story row to render. */
  story: CodeStory;
  /**
   * Invoked when the card is activated (click / Enter / Space). M3 wires a placeholder; the
   * detail modal opens from here in M6 (§10). Optional so the card renders standalone.
   */
  onOpen?: (story: CodeStory) => void;
}

/**
 * A single story on the board (§9.2): a compact card showing its **ref** and **title**.
 *
 * The whole card is an activatable control (button) — clicking it will open the detail
 * modal in M6; for now `onOpen` is a placeholder seam. A `blocked`/`abandoned` story gets a
 * distinct treatment (amber/red edge + a state tag) so it reads as off the happy path even
 * when surfaced via the escape filter, rather than sitting silently in a column (§9.2).
 *
 * M5 adds the phase-appropriate "Open Claude Code" action; leave room for it below the
 * title. M6 makes the title inline-editable in the modal — the card stays read-only.
 */
export function StoryCard({ story, onOpen }: StoryCardProperties) {
  const escape = isEscapeState(story.factory_state);
  const blocked = story.factory_state === 'blocked';

  return (
    <button
      type="button"
      onClick={() => onOpen?.(story)}
      data-factory-state={story.factory_state ?? undefined}
      className={cn(
        'group/card w-full rounded-lg border bg-surface px-3 py-2 text-left transition-colors duration-100 motion-reduce:transition-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        escape
          ? blocked
            ? 'border-l-2 border-l-amber-500/80 border-border hover:border-amber-500'
            : 'border-l-2 border-l-destructive/70 border-border hover:border-destructive'
          : 'border-border hover:border-accent-teal/50',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-medium text-accent-teal">{story.ref}</span>
        {escape ? (
          <span
            className={cn(
              'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide',
              blocked ? 'bg-amber-500/15 text-amber-400' : 'bg-destructive/15 text-destructive',
            )}
          >
            {blocked ? 'Blocked' : 'Abandoned'}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-foreground">{story.title}</p>
      {/* M5: phase-appropriate "Open Claude Code" action renders here when one applies. */}
    </button>
  );
}
