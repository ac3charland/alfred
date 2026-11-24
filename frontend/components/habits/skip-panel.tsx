'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { TextField } from '@/components/atoms/text-field';
import { formatShortDate } from '@/components/habits/habit-format';
import { cn } from '@/lib/utils';

interface SkipPanelProperties {
  date: string;
  onCancel: () => void;
  onSkip: (reason: string) => void;
  /** Thumb-sized: a full-width 44px field and two 44px buttons sharing the width. */
  touch?: boolean;
  /** The habit's name, shown under the title in touch mode — the sheet covers the card. */
  habitName?: string | undefined;
}

/**
 * The confirm step behind **Mark as skipped…** — deliberately the highest-friction action in
 * the view.
 *
 * Skipping is the only way to keep a chain alive at no cost: a missed day, a partial one and
 * an unlogged one all spend the allowance, and a skip spends nothing. That makes a one-tap
 * skip a streak-laundering button, and in a single-user app the only person it fools is the
 * owner. So it takes a second step and a reason — and the reason turns the escape hatch into
 * data the Friday review can actually read.
 *
 * The reason is TYPED, with no one-tap suggestions. A prefill would hand back the second of
 * the two things this step charges for: a tap that fills the field is a tap that skips the
 * day, and "Illness" chosen off a list is a category, not something a human wrote.
 */
export function SkipPanel({
  date,
  onCancel,
  onSkip,
  touch = false,
  habitName,
}: SkipPanelProperties) {
  const [reason, setReason] = React.useState('');
  const reasonRef = React.useRef<HTMLInputElement>(null);
  const canSkip = reason.trim() !== '';

  // The panel replaces the editor in place, so focus has to follow it to the field.
  React.useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  const commit = () => {
    if (canSkip) onSkip(reason.trim());
  };

  return (
    <div className={touch ? 'flex flex-col gap-3 p-4' : 'flex w-[265px] flex-col gap-2 p-2'}>
      <p className={cn('font-semibold text-foreground', touch ? 'text-base' : 'text-[13px]')}>
        Skip {formatShortDate(date)}?
        {touch && habitName !== undefined && (
          <span className="block text-[13px] font-normal text-muted-foreground">{habitName}</span>
        )}
      </p>
      {/* The consequence, in the owner's terms rather than the model's — this is the one place
          the allowance rules are explained rather than merely shown. */}
      <p className={cn('leading-relaxed text-muted-foreground', touch ? 'text-[13px]' : 'text-xs')}>
        This day won&apos;t count for or against the habit, and won&apos;t spend your allowance.
      </p>
      <TextField
        aria-label="Reason for skipping"
        placeholder="Why is this day excused?"
        value={reason}
        ref={reasonRef}
        onChange={(event_) => {
          setReason(event_.target.value);
        }}
        onKeyDown={(event_) => {
          if (event_.key === 'Enter') commit();
        }}
        className={touch ? 'h-11 w-full px-3 text-base' : 'px-2 py-1'}
      />
      <div className={touch ? 'flex gap-2' : 'flex justify-end gap-1.5'}>
        <Button
          variant="outline"
          size="sm"
          className={touch ? 'h-11 flex-1 text-[15px]' : undefined}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="accent"
          size="sm"
          className={touch ? 'h-11 flex-1 text-[15px]' : undefined}
          disabled={!canSkip}
          onClick={commit}
        >
          Skip this day
        </Button>
      </div>
    </div>
  );
}
