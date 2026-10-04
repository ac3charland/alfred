'use client';

import { Clock, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Calendar } from '@/components/atoms/calendar';
import { IconButton } from '@/components/atoms/icon-button';
import { Input } from '@/components/atoms/input';

export interface DueDatePickerProperties {
  /** The current due date (`YYYY-MM-DD` or a midnight timestamp), or null when unset. */
  dueDate: string | null;
  /** The current due time as `HH:MM`, or null when the task is due any time that day. */
  dueTime: string | null;
  /** Apply a picked day (grid or the footer's Today). The caller closes the picker. */
  onSelect: (iso: string) => void;
  /** Clear the date — and with it the time. The caller closes the picker. */
  onClear: () => void;
  /**
   * Save a committed time, or null to clear just the time. The picker stays open. Omit it and the
   * picker has no time row.
   */
  onSetTime?: ((time: string | null) => void) | undefined;
}

const HH_MM = /^\d{2}:\d{2}$/;

/**
 * The time row under the grid: an "Add time" link until a time exists, then a native time field
 * (the phone's time wheel, a typed hh:mm on desktop) with a × that clears just the time.
 *
 * The field commits on blur or Enter — never per keystroke, or typing 3:30 would save 3:00 on the
 * way — and Escape puts the stored value back without saving. An empty or unchanged commit saves
 * nothing; × is the one way to clear.
 */
function TimeRow({
  dueTime,
  onSetTime,
}: {
  dueTime: string | null;
  onSetTime: (time: string | null) => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState(dueTime ?? '');
  // Re-seed the draft whenever the stored time moves (a save landed, × cleared it, a rollback).
  const [seeded, setSeeded] = React.useState(dueTime);
  if (seeded !== dueTime) {
    setSeeded(dueTime);
    setDraft(dueTime ?? '');
  }
  // "Add time" is a deliberate click on this very row, so focus follows it into the new field.
  const field = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);
  // Escape reverts, and the blur that can follow it (the popover closing on the same key) must
  // not then commit the abandoned draft.
  const reverted = React.useRef(false);
  // The draft last handed to `onSetTime`, so the unmount save below can't repeat a blur's.
  const lastSent = React.useRef<string | null>(null);

  const revert = () => {
    setDraft(dueTime ?? '');
    setAdding(false);
  };

  /** Hand the draft to `onSetTime` when it is a new, complete time. Touches no state. */
  const save = (): boolean => {
    if (reverted.current) return false;
    if (!HH_MM.test(draft) || draft === dueTime || draft === lastSent.current) return false;
    lastSent.current = draft;
    onSetTime(draft);
    return true;
  };

  const commit = () => {
    if (reverted.current) {
      reverted.current = false;
      return;
    }
    setAdding(false);
    if (!save()) setDraft(dueTime ?? '');
  };

  // A removed field never fires `blur`, and an outside click or the picker's own day pick closes
  // the popover by unmounting it — so a typed time is saved on unmount too.
  const latestSave = React.useRef(save);
  React.useEffect(() => {
    latestSave.current = save;
  });
  React.useEffect(
    () => () => {
      latestSave.current();
    },
    [],
  );

  if (dueTime === null && !adding) {
    return (
      <div className="mt-2 flex items-center px-1">
        {/* The footer buttons' blue-link treatment, so the row reads as one more action. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAdding(true);
          }}
          className="h-auto gap-1.5 rounded px-2 py-1 text-accent-blue hover:bg-white/[0.06] hover:text-accent-blue"
        >
          <Clock size={12} aria-hidden="true" />
          Add time
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-1 px-1">
      <Input
        type="time"
        ref={field}
        aria-label="Due time"
        value={draft}
        onChange={(event) => {
          reverted.current = false;
          lastSent.current = null;
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            reverted.current = true;
            revert();
          }
        }}
        onFocus={() => {
          reverted.current = false;
        }}
        // The native picker indicator and popup follow the app's dark theme.
        className="h-8 flex-1 [color-scheme:dark]"
      />
      {dueTime !== null && (
        <IconButton
          size="sm"
          aria-label="Clear time"
          onClick={() => {
            onSetTime(null);
          }}
        >
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
}

/**
 * The one due-date picker every entry point opens — the row's due chip, the detail panel's Due
 * chip, and ⋯ → Due date → Custom…. The month-grid {@link Calendar} with a time row between the
 * grid and its footer. A day pick goes to `onSelect` (callers save and close); a time commit goes
 * to `onSetTime` and leaves the picker open, so "time, then day" is one visit.
 */
export function DueDatePicker({
  dueDate,
  dueTime,
  onSelect,
  onClear,
  onSetTime,
}: DueDatePickerProperties) {
  return (
    <Calendar
      // A reconciled row carries a timestamp; the grid matches calendar dates.
      selected={dueDate === null ? null : dueDate.slice(0, 10)}
      onSelect={onSelect}
      onClear={onClear}
    >
      {onSetTime !== undefined && <TimeRow dueTime={dueTime} onSetTime={onSetTime} />}
    </Calendar>
  );
}
