'use client';

import { Trash2 } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { EditableTextField } from '@/components/atoms/editable-text-field';
import { IconButton } from '@/components/atoms/icon-button';
import { InlineNoteField } from '@/components/atoms/inline-note-field';
import { PickerChip } from '@/components/atoms/picker-chip';
import { AddHandleField, HandleChips } from '@/components/comms/handle-list';
import {
  PRIORITY_LABEL,
  PRIORITY_MEANING,
  PRIORITY_VALUES,
  personPriority,
} from '@/components/comms/settings-format';
import { PRIORITY_BADGE, SETTINGS_CARD } from '@/components/comms/settings.styles';
import { settle } from '@/components/comms/settle';
import { useCommsSettingsActions } from '@/lib/stores/comms-settings-store';
import type { CommPersonWithHandles } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The priority picker's entries — each one states what it does, as in the create dialog. */
const PRIORITY_OPTIONS = PRIORITY_VALUES.map((value) => ({
  value,
  label: (
    <span className="flex flex-col">
      <span className="text-card-foreground">{PRIORITY_LABEL[value]}</span>
      <span className="text-[11px] text-muted-foreground">{PRIORITY_MEANING[value]}</span>
    </span>
  ),
}));

/**
 * One roster row: who they are, how much their delay costs, and every handle that resolves to
 * them.
 *
 * Everything edits in place. The roster's own failure mode is drift — a new number, a second
 * address, nothing announcing the gap — so the cost of fixing it has to be one click from where
 * the staleness is noticed, not a modal away.
 */
export function PersonCard({
  person,
  onDelete,
}: {
  person: CommPersonWithHandles;
  onDelete: () => void;
}) {
  const { updatePerson, addHandle, removeHandle } = useCommsSettingsActions();
  const priority = personPriority(person);

  return (
    <li className={SETTINGS_CARD}>
      <div className="flex items-center gap-2">
        <EditableTextField
          value={person.name}
          label={`Edit name for ${person.name}`}
          inputClassName="text-sm font-medium"
          onSave={async (next) => {
            await updatePerson(person.id, { name: next });
          }}
        >
          <span className="truncate text-sm font-medium text-foreground">{person.name}</span>
        </EditableTextField>

        <PickerChip
          value={priority}
          options={PRIORITY_OPTIONS}
          onSelect={(next) => {
            if (next === null || next === priority) return;
            void settle(
              updatePerson(person.id, { priority: next as (typeof PRIORITY_VALUES)[number] }),
            );
          }}
          trigger={
            <Badge
              asButton
              variant="plain"
              interactive
              aria-label={`Priority for ${person.name}: ${PRIORITY_LABEL[priority]}`}
              className={cn('font-medium', PRIORITY_BADGE[priority])}
            >
              {PRIORITY_LABEL[priority]}
            </Badge>
          }
        />

        <IconButton tone="danger" aria-label={`Remove ${person.name}`} onClick={onDelete}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      <HandleChips
        handles={person.comm_handles}
        onRemove={(handle) => {
          void settle(removeHandle(person.id, handle.id));
        }}
      />

      <AddHandleField personName={person.name} onAdd={(input) => addHandle(person.id, input)} />

      <InlineNoteField
        value={person.notes}
        emptyLabel="Add a note"
        placeholder="Why they matter"
        editLabel={`Edit note for ${person.name}`}
        onSave={async (next) => {
          await updatePerson(person.id, { notes: next });
        }}
      />
    </li>
  );
}
