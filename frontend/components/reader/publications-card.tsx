'use client';

import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { EditableTextField } from '@/components/atoms/editable-text-field';
import { InlineNoteField } from '@/components/atoms/inline-note-field';
import { ToggleButton } from '@/components/atoms/toggle-button';
import { settle } from '@/components/reader/publications-settle';
import { PAUSED_CARD, PUBLICATION_CARD } from '@/components/reader/publications.styles';
import { formatPostDate } from '@/components/reader/reader-format';
import { useReaderSettingsActions } from '@/lib/stores/reader-settings-store';
import type { ReaderPublicationListItem } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * One roster card: the name (editable), the provenance chip, the pause toggle, the handle line
 * with its newest post, and a note. A paused card wears {@link PAUSED_CARD} — still fully legible,
 * visibly out of rotation, mirroring the comms settings surfaces' own pruned-card treatment.
 */
export function PublicationCard({
  publication,
  now,
}: {
  publication: ReaderPublicationListItem;
  now: Date;
}) {
  const { rename, setEnabled, setNotes } = useReaderSettingsActions();

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
