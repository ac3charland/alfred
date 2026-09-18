'use client';

import { Copy, Newspaper } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { ViewHeading } from '@/components/atoms/view-heading';
import { PublicationsCandidates } from '@/components/reader/publications-candidates';
import { PublicationCard } from '@/components/reader/publications-card';
import { settle } from '@/components/reader/publications-settle';
import { useNow } from '@/lib/hooks/use-now';
import {
  useReaderCandidates,
  useReaderPublications,
  useReaderSettingsActions,
} from '@/lib/stores/reader-settings-store';

interface PublicationsViewProperties {
  /**
   * The instant every card's "last post" date is read against. Left off in the app, where the
   * view reads the ticking clock; pinned by stories and tests, mirroring `ReadingListView`'s own
   * `now` prop — a surface whose every date is read against today is otherwise unassertable.
   */
  now?: Date | undefined;
}

/**
 * The publications segment (`/reader/publications`) — the roster the Reader claims mail against,
 * and the off-roster senders it could grow by. Auto-discovered Substack senders and hand-promoted
 * candidates read no differently once they are on the roster; the provenance chip is the only
 * trace of how each one arrived.
 */
export function PublicationsView({ now: pinnedNow }: PublicationsViewProperties) {
  const publications = useReaderPublications();
  const candidates = useReaderCandidates();
  const { copyFilterQuery } = useReaderSettingsActions();
  const liveNow = useNow();
  const now = pinnedNow ?? liveNow;

  const enabledCount = publications.filter((publication) => publication.enabled).length;
  const pausedCount = publications.length - enabledCount;
  const nothingEnabled = enabledCount === 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ViewHeading
          icon={Newspaper}
          title="Publications"
          description="Who the Reader summarises. Auto-added from Substack; anyone else you promote from the candidates below."
          accent="reader"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={nothingEnabled}
          title={
            nothingEnabled
              ? 'Nothing to copy — no publication is enabled'
              : 'Copy the Gmail filter query that matches the enabled roster'
          }
          onClick={() => {
            void settle(copyFilterQuery());
          }}
        >
          <Copy size={14} />
          Copy Gmail filter query
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {String(enabledCount)} enabled · {String(pausedCount)} paused
      </p>

      {publications.length === 0 ? (
        <EmptyState
          title="No publications yet."
          description="Substack senders are added automatically once their mail arrives; promote anyone else from the candidates."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {publications.map((publication) => (
            <PublicationCard key={publication.id} publication={publication} now={now} />
          ))}
        </ul>
      )}

      <PublicationsCandidates candidates={candidates} now={now} />
    </div>
  );
}
