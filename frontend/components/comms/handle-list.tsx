'use client';

import { Plus, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { IconButton } from '@/components/atoms/icon-button';
import { TextField } from '@/components/atoms/text-field';
import { ToggleButton } from '@/components/atoms/toggle-button';
import { HANDLE_CHIP, SETTINGS_CAPTION } from '@/components/comms/settings.styles';
import type { AddHandleInput } from '@/lib/api-client';
import type { CommHandle } from '@/lib/types';

/**
 * Everything that renders a handle: the growing editor the create dialog uses, the chips a
 * person's card shows, and the one-off field that adds another to an existing person.
 *
 * They live together because a handle is never edited in place — it is added or dropped whole.
 * The address is the join key the classifier resolves a sender through, so a half-typed edit
 * would silently stop matching the messages it belongs to; add-and-remove makes that impossible.
 */

export type CommHandleKind = AddHandleInput['kind'];

/** One row of the create dialog's handle editor, before anything has been written. */
export interface HandleDraft {
  /** Local only — a React key, never sent. The server assigns the stored handle's id. */
  key: string;
  handle: string;
  kind: CommHandleKind;
}

let draftSequence = 0;

export function makeHandleDraft(): HandleDraft {
  draftSequence += 1;
  return { key: `draft-${String(draftSequence)}`, handle: '', kind: 'email' };
}

/** The email / phone switch. Two pills rather than a select: there are exactly two answers. */
function KindToggle({
  value,
  onChange,
  label,
}: {
  value: CommHandleKind;
  onChange: (kind: CommHandleKind) => void;
  label: string;
}) {
  return (
    <div className="flex shrink-0 gap-1" role="group" aria-label={label}>
      <ToggleButton
        pressed={value === 'email'}
        onToggle={() => {
          onChange('email');
        }}
      >
        Email
      </ToggleButton>
      <ToggleButton
        pressed={value === 'phone'}
        onToggle={() => {
          onChange('phone');
        }}
      >
        Phone
      </ToggleButton>
    </div>
  );
}

/**
 * The create dialog's handle editor: a row per handle, and a button that grows the list. A
 * person can be created with none — the roster is keyed on the human, and the addresses often
 * turn up one at a time afterwards.
 */
export function HandleDraftList({
  drafts,
  onChange,
}: {
  drafts: HandleDraft[];
  onChange: (drafts: HandleDraft[]) => void;
}) {
  const patch = (key: string, patchValue: Partial<HandleDraft>) => {
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patchValue } : draft)));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className={SETTINGS_CAPTION}>Handles</p>
      {drafts.map((draft, index) => (
        <div key={draft.key} className="flex items-center gap-2">
          <KindToggle
            value={draft.kind}
            label={`Handle ${String(index + 1)} kind`}
            onChange={(kind) => {
              patch(draft.key, { kind });
            }}
          />
          <TextField
            className="flex-1"
            aria-label={`Handle ${String(index + 1)}`}
            placeholder={draft.kind === 'email' ? 'dana@example.com' : '+1 555 010 2233'}
            value={draft.handle}
            onChange={(event_) => {
              patch(draft.key, { handle: event_.target.value });
            }}
          />
          <IconButton
            tone="danger"
            aria-label={`Remove handle ${String(index + 1)}`}
            onClick={() => {
              onChange(drafts.filter((row) => row.key !== draft.key));
            }}
          >
            <X size={14} />
          </IconButton>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        onClick={() => {
          onChange([...drafts, makeHandleDraft()]);
        }}
      >
        <Plus size={14} />
        Add handle
      </Button>
    </div>
  );
}

/** A person's stored handles, each with the × that drops it. */
export function HandleChips({
  handles,
  onRemove,
}: {
  handles: CommHandle[];
  onRemove: (handle: CommHandle) => void;
}) {
  if (handles.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/60">
        No handles yet — nothing resolves to this person.
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {handles.map((handle) => (
        <li key={handle.id} className={HANDLE_CHIP}>
          <span>{handle.handle}</span>
          <IconButton
            size="sm"
            tone="danger"
            aria-label={`Remove ${handle.handle}`}
            onClick={() => {
              onRemove(handle);
            }}
          >
            <X size={12} />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

/**
 * The card's "Add handle" affordance: a button that swaps for a kind switch and a field. Closed
 * by default, because a roster row is read far more often than it is extended.
 */
export function AddHandleField({
  personName,
  onAdd,
}: {
  personName: string;
  onAdd: (input: AddHandleInput) => Promise<unknown>;
}) {
  const [open, setOpen] = React.useState(false);
  const [handle, setHandle] = React.useState('');
  const [kind, setKind] = React.useState<CommHandleKind>('email');

  const close = () => {
    setOpen(false);
    setHandle('');
    setKind('email');
  };

  const submit = async () => {
    const trimmed = handle.trim();
    if (trimmed === '') return;
    // Closed before the await, so the optimistic chip is what the owner sees next rather than a
    // form sitting open for the whole round-trip.
    close();
    try {
      await onAdd({ handle: trimmed, kind });
    } catch {
      // The store toasted and left the roster as it was; there is nothing to re-open into.
    }
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus size={14} />
        Add handle
      </Button>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event_) => {
        event_.preventDefault();
        void submit();
      }}
    >
      <KindToggle value={kind} onChange={setKind} label={`New handle kind for ${personName}`} />
      <TextField
        className="flex-1"
        aria-label={`New handle for ${personName}`}
        placeholder={kind === 'email' ? 'dana@example.com' : '+1 555 010 2233'}
        value={handle}
        onChange={(event_) => {
          setHandle(event_.target.value);
        }}
        onKeyDown={(event_) => {
          if (event_.key === 'Escape') close();
        }}
      />
      <Button type="submit" size="sm" variant="accent" disabled={handle.trim() === ''}>
        Add
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={close}
      >
        Cancel
      </Button>
    </form>
  );
}
