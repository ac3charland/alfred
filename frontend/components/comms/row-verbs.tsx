'use client';

import { ExternalLink, RefreshCw, UserPlus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import type { DeepLink } from '@/lib/comms/deep-link';
import type { CommTier } from '@/lib/types';

import { TierMenu } from './tier-menu';

/**
 * The verbs on an expanded row.
 *
 * Five of them, and the shape is a decision rather than a layout: the two CLEARING verbs are
 * separate because only one of them is a correction. "Nothing to answer" says the row should
 * never have been queued and teaches the classifier that; "Not replying" says the verdict was
 * right and the owner is declining. One button cannot mean both, and collapsing them makes the
 * cheap gesture the uninformative one — which starves the example set exactly where the recall
 * bias guarantees the corrections are richest.
 *
 * Two smaller affordances sit apart from the five: asking for a re-run, and adding the sender to
 * the roster. The second is here because a roster drifts silently, and the moment the owner
 * notices the gap is the moment a message was mistiered — so the fix has to be reachable from
 * that message and not only from a settings page.
 */

/** What the row can do, wired by the row so its hotkeys and its buttons fire the same code. */
export interface RowVerbHandlers {
  makeInboxItem: () => void;
  nothingToAnswer: () => void;
  notReplying: () => void;
  changeTier: (tier: CommTier) => void;
  reclassify: () => void;
  addSender: () => void;
}

interface RowVerbsProperties {
  link: DeepLink;
  /** The row holds this so its `o` hotkey can click the same anchor the owner would. */
  linkRef: React.Ref<HTMLAnchorElement>;
  currentTier: CommTier | null;
  handlers: RowVerbHandlers;
  tierMenuOpen: boolean;
  onTierMenuOpenChange: (open: boolean) => void;
  /**
   * A shelf row offers only the two verbs that still mean something there: opening it at the
   * source, and promoting it back into the queue. It is already cleared, so there is nothing to
   * clear, and spinning off an obligation nobody thinks exists is not a thing to offer.
   */
  shelved?: boolean;
}

export function RowVerbs({
  link,
  linkRef,
  currentTier,
  handlers,
  tierMenuOpen,
  onTierMenuOpenChange,
  shelved = false,
}: RowVerbsProperties) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {link.href === undefined ? (
          // Disabled rather than absent, and it says why: a row whose verb quietly vanished
          // reads as a row that has nothing wrong with it.
          <Button variant="outline" size="sm" disabled title={link.unavailable}>
            <ExternalLink size={13} aria-hidden="true" />
            {link.label}
          </Button>
        ) : (
          <Button variant="outline" size="sm" asChild>
            <a ref={linkRef} href={link.href}>
              <ExternalLink size={13} aria-hidden="true" />
              {link.label}
            </a>
          </Button>
        )}

        {!shelved && (
          <>
            <Button variant="outline" size="sm" onClick={handlers.makeInboxItem}>
              Make an Inbox item
            </Button>
            <Button variant="outline" size="sm" onClick={handlers.nothingToAnswer}>
              Nothing to answer
            </Button>
            <Button variant="outline" size="sm" onClick={handlers.notReplying}>
              Not replying
            </Button>
          </>
        )}

        <TierMenu
          current={currentTier}
          onSelect={handlers.changeTier}
          open={tierMenuOpen}
          onOpenChange={onTierMenuOpenChange}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={handlers.reclassify}>
          <RefreshCw size={12} aria-hidden="true" />
          Re-run classifier
        </Button>
        <Button variant="ghost" size="sm" onClick={handlers.addSender}>
          <UserPlus size={12} aria-hidden="true" />
          Add sender to people
        </Button>
      </div>
    </div>
  );
}
