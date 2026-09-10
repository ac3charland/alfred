'use client';

import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import type { CommTier } from '@/lib/types';

import { TIER_LABEL } from './comms-format';

/**
 * The tier picker — the fifth verb, and the one that teaches most.
 *
 * Every pick is recorded as a correction, and the pick that matters is the promotion OUT of
 * FYI: tier membership is also the entry ticket to the queue, so moving a shelved row
 * back into a counted tier corrects the obligation judgment rather than the urgency. It is the
 * only route back from a message the classifier wrongly shelved, which is the failure the
 * module is organised against — so the picker is offered on shelf rows too, not just queued ones.
 */

/** All four, in the order the module ranks them. `fyi` is included: demotion is a real answer. */
const TIERS: CommTier[] = ['asap', 'today', 'whenever', 'fyi'];

interface TierMenuProperties {
  /** The tier the row is in now, checked in the list. */
  current: CommTier | null;
  onSelect: (tier: CommTier) => void;
  /** Controlled, so the row's `t` hotkey can open the same menu the button does. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TierMenu({ current, onSelect, open, onOpenChange }: TierMenuProperties) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Change tier
          <ChevronDown size={13} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TIERS.map((tier) => (
          <DropdownMenuItem
            key={tier}
            // The row's current tier, stated as data rather than only as a glyph, so "which one
            // is checked" is assertable and not a screenshot-only fact.
            data-current={tier === current ? 'true' : undefined}
            onSelect={() => {
              onSelect(tier);
            }}
          >
            <span className="flex w-3.5 shrink-0 items-center justify-center">
              {tier === current && <Check size={13} aria-hidden="true" />}
            </span>
            <span>{TIER_LABEL[tier]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
