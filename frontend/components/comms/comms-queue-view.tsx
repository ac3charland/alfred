'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { QUEUED_TIERS } from '@/lib/comms';
import { rowHotkeyAction } from '@/lib/comms/hotkeys';
import { useNow } from '@/lib/hooks/use-now';
import { useCommsPeople } from '@/lib/stores/comms-settings-store';
import {
  useCommsAccounts,
  useCommsHealth,
  useCommsMessages,
  useCommsVerdicts,
  useQueuedByTier,
  useShelf,
} from '@/lib/stores/comms-store';
import type { CommMessage } from '@/lib/types';

import { AddSenderDialog } from './add-sender-dialog';
import { accountLabel } from './comms-format';
import { CommsHeader } from './comms-header';
import { FyiShelf } from './fyi-shelf';
import { MessageRow } from './message-row';
import { TierSection } from './tier-section';

/**
 * The Comms queue (`/comms`) — the module's default view and the one question it exists to
 * answer: what do I owe someone a reply to?
 *
 * Three counted tiers and an unbadged, collapsed shelf. Only messages that ask something are
 * queued, so zero here is the resting state the module is built to reach and not an error — and
 * an FYI shelf in the thousands sitting beneath a queue of nothing is the module working, not a
 * backlog.
 *
 * Everything is derived from the one seeded message list: the tiers, the shelf, the health
 * indicators, and every row marker. Nothing here fetches.
 */

/**
 * How many shelf rows are drawn at a time. Sixty days of FYI is thousands of rows and
 * the shelf is opened to spot-check the rubric, not to read — so it pages, and the promotion
 * path stays reachable through "Show more" rather than through mounting the whole archive.
 */
const SHELF_PAGE = 50;

/** Shown when the queue is empty AND the shelf is too — a genuinely empty module. */
const EMPTY_DESCRIPTION =
  'Messages that ask something of you will queue here. Everything else lands on the FYI shelf.';

interface CommsQueueViewProperties {
  /**
   * The instant every health state, expiry marker and timestamp is read against. Left off in
   * the app, where the view ticks its own clock; pinned by stories and tests, since a surface
   * whose whole content is "how long ago" is otherwise unassertable and unsnapshottable.
   */
  now?: Date | undefined;
}

export function CommsQueueView({ now: pinnedNow }: CommsQueueViewProperties) {
  const accounts = useCommsAccounts();
  const messages = useCommsMessages();
  const byTier = useQueuedByTier();
  const shelf = useShelf();
  const verdicts = useCommsVerdicts();
  const health = useCommsHealth();
  const people = useCommsPeople();

  // A ticking clock, because every health state and every expiry marker is a comparison against
  // now. Stories and tests pin it so a surface whose whole content is "how long ago" can be
  // asserted and snapshotted at all.
  const ticking = useNow();
  const now = pinnedNow ?? ticking;

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [addingSenderFor, setAddingSenderFor] = React.useState<CommMessage | undefined>();
  const [shelfOpen, setShelfOpen] = React.useState(false);
  const [shelfLimit, setShelfLimit] = React.useState(SHELF_PAGE);

  const visibleShelf = React.useMemo(() => shelf.slice(0, shelfLimit), [shelf, shelfLimit]);

  // The order `j`/`k` walk: the queue as drawn, then the shelf if it has been opened. Built from
  // the same lists the sections render, so navigation can never disagree with the page.
  const orderedIds = React.useMemo(() => {
    const queued = QUEUED_TIERS.flatMap((tier) => byTier[tier].map((message) => message.id));
    return shelfOpen ? [...queued, ...visibleShelf.map((message) => message.id)] : queued;
  }, [byTier, visibleShelf, shelfOpen]);

  // Navigation and Escape live here rather than on a row, because they have to work when
  // nothing is selected at all — `j` on a fresh page selects the first row. The verbs are the
  // selected ROW's, so exactly one row-level listener is ever attached.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = rowHotkeyAction(event);
      if (action === undefined) return;

      if (action === 'deselect') {
        setSelectedId(null);
        return;
      }
      if (action !== 'next' && action !== 'previous') return;

      event.preventDefault();
      setSelectedId((current) => {
        if (orderedIds.length === 0) return current;
        const index = current === null ? -1 : orderedIds.indexOf(current);
        const step = action === 'next' ? 1 : -1;
        // A first press lands on the top row whichever direction it was; after that the ends
        // hold rather than wrap, so a held key can't cycle the queue forever.
        if (index === -1) return orderedIds[0] ?? null;
        const next = Math.min(Math.max(index + step, 0), orderedIds.length - 1);
        return orderedIds[next] ?? current;
      });
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [orderedIds]);

  const renderRow = (message: CommMessage, shelved: boolean) => {
    const { account, label } = accountLabel(accounts, message.account_id);
    return (
      <MessageRow
        key={message.id}
        message={message}
        account={account}
        accountLabel={label}
        people={people}
        verdict={message.verdict_id === null ? undefined : verdicts[message.verdict_id]}
        now={now}
        selected={selectedId === message.id}
        onSelect={setSelectedId}
        onAddSender={setAddingSenderFor}
        shelved={shelved}
      />
    );
  };

  const queueEmpty = orderedIds.length === 0 && shelf.length === 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <CommsHeader accounts={accounts} messages={messages} health={health} now={now} />

      {queueEmpty ? (
        <EmptyState title="Nothing to answer." description={EMPTY_DESCRIPTION} />
      ) : (
        <div className="flex flex-col gap-4">
          {QUEUED_TIERS.map((tier) => (
            <TierSection
              key={tier}
              tier={tier}
              count={byTier[tier].length}
              // Only Today says anything when it is empty: that is the sentence the
              // module is built to be able to show.
              emptyLabel={tier === 'today' ? 'Nothing to answer today.' : undefined}
            >
              {byTier[tier].map((message) => renderRow(message, false))}
            </TierSection>
          ))}

          <FyiShelf count={shelf.length} onOpenChange={setShelfOpen}>
            {visibleShelf.map((message) => renderRow(message, true))}
            {shelf.length > visibleShelf.length && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  setShelfLimit((current) => current + SHELF_PAGE);
                }}
              >
                Show more ({String(shelf.length - visibleShelf.length)} older)
              </Button>
            )}
          </FyiShelf>
        </div>
      )}

      <AddSenderDialog
        message={addingSenderFor}
        onOpenChange={(open) => {
          if (!open) setAddingSenderFor(undefined);
        }}
      />
    </div>
  );
}
