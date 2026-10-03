'use client';

import { ChevronDown, Plus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { EmptyState } from '@/components/atoms/empty-state';
import { settle } from '@/components/reader/publications-settle';
import { PUBLICATION_CAPTION } from '@/components/reader/publications.styles';
import { formatPostDate } from '@/components/reader/reader-format';
import { SUMMARY_KIND_OPTIONS } from '@/lib/reader/kinds';
import { useReaderSettingsActions } from '@/lib/stores/reader-settings-store';
import type { ReaderCandidate, ReaderSummaryKind } from '@/lib/types';

/**
 * The candidates section beneath the roster: bulk senders seen on the personal mailbox in the
 * last 30 days that are not on the roster yet, one row each, promotable with "Add as" and a kind.
 * The kind is asked for up front because promotion claims the sender's last seven days of mail on
 * the very next tick: an Add that defaulted to Essay would spend summaries reading a shop's promos
 * as essays before the owner could change it.
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
  // Which handles have an Add in flight — a promoted candidate leaves this list on success, but
  // a 500 (or a slow network) leaves the row in place, and a second click before the first
  // settles would fire a second POST for the same handle. Local, not store state: nothing else
  // reads it, and it clears itself in the `finally` regardless of outcome.
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());

  const add = (handle: string, kind: ReaderSummaryKind) => {
    setPending((current) => new Set(current).add(handle));
    void settle(addCandidate(handle, kind)).finally(() => {
      setPending((current) => {
        const next = new Set(current);
        next.delete(handle);
        return next;
      });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className={PUBLICATION_CAPTION}>
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
                  {String(candidate.message_count)} message
                  {candidate.message_count === 1 ? '' : 's'} · last{' '}
                  {formatPostDate(candidate.last_seen_at, now)}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="accent"
                    size="sm"
                    disabled={pending.has(candidate.handle)}
                    aria-label={`Add ${candidate.name ?? candidate.handle} as…`}
                  >
                    <Plus size={14} />
                    Add as
                    <ChevronDown size={14} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {SUMMARY_KIND_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() => {
                        add(candidate.handle, option.value);
                      }}
                    >
                      <span className="flex flex-col">
                        <span>{option.label}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
