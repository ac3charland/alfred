'use client';

import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { ClickableCard } from '@/components/atoms/clickable-card';
import { askLine } from '@/lib/comms/ask';
import { messageDeepLink } from '@/lib/comms/deep-link';
import { rowHotkeyAction } from '@/lib/comms/hotkeys';
import { useAnimatedRowExit } from '@/lib/hooks/use-animated-row-exit';
import { useCommsActions } from '@/lib/stores/comms-store';
import type {
  CommAccount,
  CommMessage,
  CommPersonWithHandles,
  CommTier,
  CommVerdict,
} from '@/lib/types';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

import { formatMessageTime, senderLabel } from './comms-format';
import { MessageDetail } from './message-detail';
import {
  rowAskClass,
  rowAskSelectedClass,
  rowCollapseClass,
  rowCollapseInnerClass,
  rowFadeClass,
  rowMetaClass,
  rowSenderClass,
  rowShellClass,
} from './message-row.styles';
import { RowMarkers } from './row-markers';
import type { RowVerbHandlers } from './row-verbs';

/**
 * One row of the queue: who, what they want, and — once selected — the message and the verbs.
 *
 * Every row leads with the ASK rather than the subject, because the thing that makes triage
 * aversive is not knowing whether a message contains an obligation. A subject line preserves
 * that ambiguity and forces the owner to open the message to resolve it, which is precisely the
 * work the module exists to remove.
 *
 * The row owns three things the view cannot: the exit animation (a cleared row collapses before
 * its mutation commits, so the list doesn't jump), the tier menu's open state (so the `t` hotkey
 * and the button open the same menu), and — while it is the selected row — the verb hotkeys.
 * Selection itself belongs to the view, since only one row in the module may hold it.
 */

export interface MessageRowProperties {
  message: CommMessage;
  /** The account it arrived on; `undefined` only if the account row has gone missing. */
  account: CommAccount | undefined;
  accountLabel: string;
  people: CommPersonWithHandles[];
  verdict: CommVerdict | undefined;
  now: Date;
  selected: boolean;
  /** Select this row, or clear the selection entirely. */
  onSelect: (id: string | null) => void;
  /** Open the "add this sender to the roster" dialog for this message. */
  onAddSender: (message: CommMessage) => void;
  /** A shelf row is muted and offers only the verbs that still mean something there. */
  shelved?: boolean;
}

export function MessageRow({
  message,
  account,
  accountLabel,
  people,
  verdict,
  now,
  selected,
  onSelect,
  onAddSender,
  shelved = false,
}: MessageRowProperties) {
  const actions = useCommsActions();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [tierMenuOpen, setTierMenuOpen] = React.useState(false);
  const linkRef = React.useRef<HTMLAnchorElement>(null);

  // The mutation the exit is playing for. Held in a ref so the commit callback stays stable
  // across renders while still running whichever verb started the exit.
  const commitRef = React.useRef<(() => Promise<unknown>) | null>(null);
  const commit = React.useCallback(async () => {
    await commitRef.current?.();
  }, []);
  const exit = useAnimatedRowExit(commit, prefersReducedMotion);
  const { begin } = exit;

  const runExit = React.useCallback(
    (mutation: () => Promise<unknown>) => {
      // A second verb pressed inside the first one's 300ms exit window must be dropped, not
      // silently retarget the pending commit — `begin()` is a no-op once already exiting, so
      // without this guard `commitRef` would be overwritten while the original animation kept
      // playing and the first mutation would never run.
      if (exit.isExiting) return;
      commitRef.current = mutation;
      begin();
    },
    [begin, exit.isExiting],
  );

  const link = messageDeepLink(message, account);
  const messageId = message.id;

  const handlers: RowVerbHandlers = React.useMemo(
    () => ({
      makeInboxItem: () => {
        runExit(() => actions.makeInboxItem(messageId));
      },
      nothingToAnswer: () => {
        runExit(() => actions.clearMessage(messageId, 'nothing_to_answer'));
      },
      notReplying: () => {
        runExit(() => actions.clearMessage(messageId, 'not_replying'));
      },
      changeTier: (tier: CommTier) => {
        // Picking the tier the row is already in is not a correction, so it is not a write and
        // certainly not an exit animation.
        if (tier === message.tier) return;
        runExit(() => actions.changeTier(messageId, tier));
      },
      reclassify: () => {
        // No exit: asking for a re-run does not move the row, and pretending it did would show
        // a judgment that has not happened yet.
        void (async () => {
          try {
            await actions.requestReclassify(messageId);
          } catch {
            // The store has already rolled the row back and toasted; nothing to add here.
          }
        })();
      },
      addSender: () => {
        onAddSender(message);
      },
    }),
    [actions, message, messageId, onAddSender, runExit],
  );

  // The verb hotkeys, live only while this row is the selected one — so exactly one listener is
  // attached at a time however long the queue is. Navigation and Escape are the view's, since
  // they have to work when nothing is selected at all.
  React.useEffect(() => {
    if (!selected) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const action = rowHotkeyAction(event);
      if (action === undefined) return;
      switch (action) {
        case 'open': {
          event.preventDefault();
          linkRef.current?.click();
          break;
        }
        case 'inbox': {
          if (shelved) break;
          event.preventDefault();
          handlers.makeInboxItem();
          break;
        }
        case 'nothing': {
          if (shelved) break;
          event.preventDefault();
          handlers.nothingToAnswer();
          break;
        }
        case 'not_replying': {
          if (shelved) break;
          event.preventDefault();
          handlers.notReplying();
          break;
        }
        case 'tier': {
          event.preventDefault();
          setTierMenuOpen(true);
          break;
        }
        default: {
          // `next` / `previous` / `deselect` belong to the view.
          break;
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selected, shelved, handlers]);

  return (
    <div
      data-testid="comms-row-collapse"
      className={cn(rowCollapseClass, exit.isExiting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}
      onTransitionEnd={exit.onCollapseEnd}
    >
      <div className={cn('overflow-hidden', rowCollapseInnerClass)}>
        <div className={cn(rowFadeClass, exit.isExiting && 'opacity-0')}>
          <div className={rowShellClass(selected, shelved)} data-testid="comms-row">
            <ClickableCard
              aria-expanded={selected}
              onClick={() => {
                // A click toggles: the same gesture opens the row and closes it again. Focus
                // deliberately does NOT select — a click focuses before it clicks, so selecting
                // on focus would make every first click select and then immediately deselect.
                onSelect(selected ? null : messageId);
              }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={rowSenderClass}>{senderLabel(message, people)}</span>
                <span className={rowMetaClass}>
                  · {accountLabel} · {formatMessageTime(message.received_at, now)}
                </span>
              </div>
              <p className={selected ? rowAskSelectedClass : rowAskClass}>{askLine(message)}</p>
              <div className="mt-1.5">
                <RowMarkers message={message} people={people} now={now} shelved={shelved} />
              </div>
            </ClickableCard>

            <AnimatedHeightCollapse open={selected} testId="comms-row-detail">
              <MessageDetail
                message={message}
                accountLabel={accountLabel}
                verdict={verdict}
                now={now}
                link={link}
                linkRef={linkRef}
                currentTier={message.tier}
                handlers={handlers}
                tierMenuOpen={tierMenuOpen}
                onTierMenuOpenChange={setTierMenuOpen}
                shelved={shelved}
              />
            </AnimatedHeightCollapse>
          </div>
        </div>
      </div>
    </div>
  );
}
