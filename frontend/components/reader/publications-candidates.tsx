'use client';

import { Plus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { settle } from '@/components/reader/publications-settle';
import { formatPostDate } from '@/components/reader/reader-format';
import { useReaderSettingsActions } from '@/lib/stores/reader-settings-store';
import type { ReaderCandidate } from '@/lib/types';

/**
 * The candidates section beneath the roster: bulk senders seen on the personal mailbox in the
 * last 30 days that are not on the roster yet, one row each, promotable with a single "Add".
 * Ranking is the view's own (`v_reader_candidates`) — this component renders whatever order it
 * is handed rather than re-sorting.
 */
export function PublicationsCandidates({
  candidates,
  now,
}: {
  candidates: ReaderCandidate[];
  now: Date;
}) {
  const { addCandidate } = useReaderSettingsActions();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
        Candidates — bulk senders not on the roster · last 30 days
      </p>

      {candidates.length === 0 ? (
        <EmptyState
          title="No candidates."
          description="Every bulk sender from the last 30 days is already on the roster."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((candidate) => (
            <li
              key={candidate.handle}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {candidate.name ?? candidate.handle}
                </span>
                <span className="text-xs text-muted-foreground">{candidate.handle}</span>
                <span className="text-xs text-muted-foreground">
                  {String(candidate.message_count)} messages · last{' '}
                  {formatPostDate(candidate.last_seen_at, now)}
                </span>
              </div>
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  void settle(addCandidate(candidate.handle));
                }}
              >
                <Plus size={14} />
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
