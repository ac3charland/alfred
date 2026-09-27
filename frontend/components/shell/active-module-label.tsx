'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { MODULE_ACCENT, MODULE_LABEL, activeModule } from '@/lib/modules';
import { cn } from '@/lib/utils';

/**
 * The open module's name, shown at the right edge of the sidebar's wordmark row, opposite
 * `alfred` (ALF-270). Plain text, not a link — the wordmark keeps its only job (back to
 * capture) and `ViewSwitcher`'s `aria-current` stays the programmatic source of truth for which
 * module is active. Reads `MODULE_LABEL` (the same table the switcher's `aria-label`s use) so
 * the two can't disagree, and wears the module's own accent so the raised switcher icon and this
 * name read as the same thing.
 */
export function ActiveModuleLabel() {
  const current = activeModule(usePathname());
  return (
    <span className={cn('min-w-0 truncate text-[13px] font-medium', MODULE_ACCENT[current].text)}>
      {MODULE_LABEL[current]}
    </span>
  );
}
