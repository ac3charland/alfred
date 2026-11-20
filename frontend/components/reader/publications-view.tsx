'use client';

import { Copy, Newspaper, Search } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { Input } from '@/components/atoms/input';
import { ViewHeading } from '@/components/atoms/view-heading';
import { AddFeedForm } from '@/components/reader/add-feed-form';
import { isFeed } from '@/components/reader/feed-format';
import { PublicationsCandidates } from '@/components/reader/publications-candidates';
import { PublicationCard } from '@/components/reader/publications-card';
import { matchesPublicationQuery } from '@/components/reader/publications-search';
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
 * trace of how each one arrived. Feeds are added by URL in the field above the roster and sit in
 * it beside the senders, a `feed` chip in place of the provenance. A search box over the roster
 * narrows the cards to those matching its query; the counts and the copy button still speak for
 * the whole roster, and the candidates are never filtered.
 */
export function PublicationsView({ now: pinnedNow }: PublicationsViewProperties) {
  const publications = useReaderPublications();
  const candidates = useReaderCandidates();
  const { copyFilterQuery } = useReaderSettingsActions();
  const liveNow = useNow();
  const now = pinnedNow ?? liveNow;
  const [query, setQuery] = React.useState('');
  // A publication that just joined the roster (an added feed, a promoted candidate) would sit
  // hidden behind a query it doesn't match, so the add would seem to vanish: a growing roster
  // clears the query. Adjusted during render, React's pattern for state that follows a prop.
  const [rosterSize, setRosterSize] = React.useState(publications.length);
  if (publications.length !== rosterSize) {
    setRosterSize(publications.length);
    if (publications.length > rosterSize) setQuery('');
  }
  const shown = publications.filter((publication) => matchesPublicationQuery(publication, query));

  const enabledCount = publications.filter((publication) => publication.enabled).length;
  const pausedCount = publications.length - enabledCount;
  const nothingEnabled = enabledCount === 0;
  // The Gmail filter only ever matches senders: a roster of nothing but feeds has nothing to copy.
  const noSenderEnabled = !publications.some(
    (publication) => publication.enabled && !isFeed(publication),
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ViewHeading
          icon={Newspaper}
          title="Publications"
          description="Who the Reader summarises. Substack is added automatically, blogs by their feed URL, and anyone else you promote from the candidates below."
          accent="reader"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={noSenderEnabled}
          title={
            noSenderEnabled
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
        {nothingEnabled && (
          <span className="ml-2 text-muted-foreground/70">
            — nothing to copy: no publication is enabled
          </span>
        )}
      </p>

      <AddFeedForm />

      {publications.length === 0 ? (
        <EmptyState
          title="No publications yet."
          description="Substack senders are added automatically once their mail arrives; add a blog by its feed URL above, or promote anyone else from the candidates."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Search publications"
              placeholder="Search publications"
              value={query}
              onChange={(event_) => {
                setQuery(event_.target.value);
              }}
              className="pl-9"
            />
          </div>
          {shown.length === 0 ? (
            <EmptyState title={`No publications match “${query.trim()}”.`} />
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((publication) => (
                <PublicationCard key={publication.id} publication={publication} now={now} />
              ))}
            </ul>
          )}
        </div>
      )}

      <PublicationsCandidates candidates={candidates} now={now} />
    </div>
  );
}
