'use client';

import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { EditableTextField } from '@/components/atoms/editable-text-field';
import { InlineNoteField } from '@/components/atoms/inline-note-field';
import { PickerChip } from '@/components/atoms/picker-chip';
import { ToggleButton } from '@/components/atoms/toggle-button';
import { settle } from '@/components/reader/publications-settle';
import { KIND_CHIP, PAUSED_CARD, PUBLICATION_CARD } from '@/components/reader/publications.styles';
import { formatPostDate } from '@/components/reader/reader-format';
import { SUMMARY_KIND_OPTIONS, summaryKindLabel } from '@/lib/reader/kinds';
import { summaryKindOf } from '@/lib/reader/overview';
import { useReaderSettingsActions } from '@/lib/stores/reader-settings-store';
import type { ReaderPublicationListItem } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The kind picker's entries — each one says what the summariser will ask, as the chip promises. */
const KIND_OPTIONS = SUMMARY_KIND_OPTIONS.map((option) => ({
  value: option.value,
  label: (
    <span className="flex flex-col">
      <span className="text-card-foreground">{option.label}</span>
      <span className="text-[11px] text-muted-foreground">{option.description}</span>
    </span>
  ),
}));

/**
 * One roster card: the name (editable), the provenance chip, the kind chip, the pause toggle, the
 * handle line with its newest post, and a note. The kind chip picks which question the summariser
 * asks of this publication's mail; a pick saves at once and applies to the next summary, never to
 * one already written. A paused card wears {@link PAUSED_CARD} — still fully legible,
 * visibly out of rotation, mirroring the comms settings surfaces' own pruned-card treatment.
 */
export function PublicationCard({
  publication,
  now,
}: {
  publication: ReaderPublicationListItem;
  now: Date;
}) {
  const { rename, setEnabled, setNotes, setKind } = useReaderSettingsActions();
  const kind = summaryKindOf(publication);

  return (
    <li className={cn(PUBLICATION_CARD, !publication.enabled && PAUSED_CARD)}>
      <div className="flex items-center gap-2">
        <EditableTextField
          value={publication.name}
          label={`Edit name for ${publication.name}`}
          inputClassName="text-sm font-medium"
          onSave={async (next) => {
            await rename(publication.id, next);
          }}
        >
          <span className="truncate text-sm font-medium text-foreground">{publication.name}</span>
        </EditableTextField>

        <Badge variant="muted">{publication.source}</Badge>

        <PickerChip
          value={kind}
          options={KIND_OPTIONS}
          onSelect={(next) => {
            const picked = SUMMARY_KIND_OPTIONS.find((option) => option.value === next)?.value;
            if (picked === undefined || picked === kind) return;
            void settle(setKind(publication.id, picked));
          }}
          trigger={
            <Badge
              asButton
              variant="muted"
              interactive
              aria-label={`Summary type for ${publication.name}: ${summaryKindLabel(kind)}`}
              className={KIND_CHIP}
            >
              {summaryKindLabel(kind)}
              <ChevronDown size={12} aria-hidden="true" />
            </Badge>
          }
        />

        <ToggleButton
          className="ml-auto"
          pressed={publication.enabled}
          onToggle={() => {
            void settle(setEnabled(publication.id, !publication.enabled));
          }}
          title="Paused publications are not claimed; posts already here stay. Re-enabling claims only mail from the last seven days."
        >
          {publication.enabled ? 'Enabled' : 'Paused'}
        </ToggleButton>
      </div>

      <p className="text-xs text-muted-foreground">
        {publication.handle} ·{' '}
        {publication.last_post_at === null
          ? 'no posts yet'
          : `last post ${formatPostDate(publication.last_post_at, now)}`}
      </p>

      <InlineNoteField
        value={publication.notes}
        emptyLabel="Add a note"
        placeholder="Add a note"
        editLabel={`Edit note for ${publication.name}`}
        onSave={async (next) => {
          await setNotes(publication.id, next);
        }}
      />
    </li>
  );
}
