'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A full-width row in a combobox-style list (e.g. the gate's project / epic pickers), with the
 * shared teal focus ring. Two kinds:
 * - `option` (default) — a selectable row: `justify-between` (label left, hint right), tinted
 *   teal when `selected`, muted hover otherwise.
 * - `action` — a "+ New …"-style action row at the foot of the list: left-aligned (no
 *   `justify-between`), all-teal with a teal hover wash, no selected state.
 */
const optionButtonVariants = cva(
  cn(
    'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm',
    'transition-colors duration-100 motion-reduce:transition-none',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal',
  ),
  {
    variants: {
      kind: { option: '', action: '' },
      selected: { true: '', false: '' },
    },
    compoundVariants: [
      // The `option` row's layout + selected/muted coloring.
      {
        kind: 'option',
        selected: true,
        className: 'justify-between bg-accent-teal/15 text-foreground',
      },
      {
        kind: 'option',
        selected: false,
        className:
          'justify-between text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      },
      // The `action` row owns its all-teal treatment; `selected` is irrelevant to it.
      {
        kind: 'action',
        selected: false,
        className: 'text-accent-teal hover:bg-accent-teal/10',
      },
      {
        kind: 'action',
        selected: true,
        className: 'text-accent-teal hover:bg-accent-teal/10',
      },
    ],
    defaultVariants: {
      kind: 'option',
      selected: false,
    },
  },
);

export interface OptionButtonProperties
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'>,
    VariantProps<typeof optionButtonVariants> {}

export const OptionButton = React.forwardRef<HTMLButtonElement, OptionButtonProperties>(
  ({ className, kind, selected, ...properties }, reference) => (
    <button
      type="button"
      ref={reference}
      className={cn(optionButtonVariants({ kind, selected }), className)}
      {...properties}
    />
  ),
);
OptionButton.displayName = 'OptionButton';

export { optionButtonVariants };
