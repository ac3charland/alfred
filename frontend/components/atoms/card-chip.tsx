import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The tone (border / fill / text accent) a card chip carries. The chrome is otherwise identical
 * across chips — only the accent and the copy/icon differ:
 * - `accent` — the primary teal call-to-action (e.g. *Refine* / *Implement*).
 * - `subordinate` — a muted, neutral chip that steps back from a nearby primary (e.g. *Skip to
 *   Development*).
 * - `link` — the blue external-navigation accent (e.g. *Review PR*).
 */
export type CardChipTone = 'accent' | 'subordinate' | 'link';

const TONE_CLASSES: Record<CardChipTone, string> = {
  accent: 'border-accent-teal/40 bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/20',
  subordinate:
    'border-border bg-transparent text-muted-foreground hover:bg-secondary hover:text-secondary-foreground',
  link: 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20',
};

/**
 * The shared chrome behind every action chip in a story card's footer: the bordered pill geometry
 * (radius, 8×4 padding, xs text), the colour transition, and the accent focus ring the card
 * controls use. The caller supplies the `tone` and the icon-plus-label `children`.
 */
const CARD_CHIP_CHROME = cn(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
  'transition-colors duration-100 motion-reduce:transition-none',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
  'disabled:cursor-not-allowed disabled:opacity-70',
);

type CardChipButtonProperties = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone: CardChipTone;
  /** A button chip never has an `href`; that discriminates it from the anchor form. */
  href?: undefined;
};

type CardChipAnchorProperties = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  tone: CardChipTone;
  /** An `href` renders the chip as a navigating anchor (opens a link) rather than a button. */
  href: string;
};

export type CardChipProperties = CardChipButtonProperties | CardChipAnchorProperties;

/**
 * A single action chip on a story card, shared by the *Open Claude Code* launch chips (rendered as
 * a `<button>`) and the *Review PR* chip (rendered as an `<a>` when given an `href`). Owns the chip
 * chrome + tone once so every card footer chip stays in sync; callers differ only in `tone`, copy,
 * icon, and whether they navigate (`href`) or act (`onClick`).
 */
export function CardChip({ tone, className, children, ...rest }: CardChipProperties) {
  const classes = cn(CARD_CHIP_CHROME, TONE_CLASSES[tone], className);

  if (rest.href !== undefined) {
    return (
      <a className={classes} {...rest}>
        {children}
      </a>
    );
  }

  const { type, ...buttonRest } = rest;
  return (
    <button type={type ?? 'button'} className={classes} {...buttonRest}>
      {children}
    </button>
  );
}
