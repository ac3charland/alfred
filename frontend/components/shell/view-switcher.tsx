'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { FolderCountBadge } from '@/components/tasks/folder-count-badge';
import { ViewLink } from '@/components/tasks/view-link';
import { MODULE_ICON } from '@/lib/module-icons';
import { MODULE_ACCENT, MODULE_LABEL, type ModuleId, activeModule } from '@/lib/modules';
import { useQueueCount } from '@/lib/stores/comms-store';
import { cn } from '@/lib/utils';

/**
 * The module switcher — a segmented control styled after the Claude desktop app. Each segment
 * navigates to one module's default view (Tasks → `/priority`, Code → `/code`, Comms →
 * `/comms`); the active segment is derived from the route through the shared `activeModule`
 * rule, so URL, content, sidebar, and switcher highlight never disagree.
 *
 * The active segment wears its OWN module's accent, read from the shared accent table rather
 * than hard-coded — Tasks amber, Code teal, Comms blue, Reader green, Wiki violet, no two alike
 * (ALF-219).
 *
 * The segments are icon-only (ALF-270): a word-per-module control widened the sidebar three
 * times over as modules were added (ALF-219, ALF-233, ALF-261) and still ran out of room at
 * five. Five equal-width icon cells (`flex-1`) never overflow and never reflow — adding a sixth
 * module just narrows every cell by a few px. The open module's name moved to the sidebar's
 * wordmark row instead (`ActiveModuleLabel`), which has the room a segment's own label never did.
 *
 * Tasks lands on the By-Priority list — the module's default view — rather than the `/`
 * capture screen; capture stays reachable via the `alfred` wordmark (see the app shell).
 *
 * Since ALF-27 every module is seeded under one shared shell layout, so switching modules no
 * longer needs an RSC navigation: this uses `ViewLink` (the History-API switch the in-module
 * views already use), NOT `next/link`. A plain primary click is a `history.pushState` — no
 * document reload, no `?_rsc=` round-trip — and every page renders the same URL-deriving
 * `ModuleRouter`, so the view follows the new URL. The segments stay real `<a href>`s:
 * modified/middle clicks and hard loads navigate natively, and keyboard users get real links.
 *
 * It takes no close/navigate callback: the mobile drawer deliberately STAYS open across a
 * module switch (ALF-157), so there is nothing for a segment click to notify.
 *
 * Comms is the LAST segment (ALF-222), not the third: it is the only segment that carries a
 * count (how many messages are waiting for a reply, `useQueueCount`), rendered as a small badge
 * over its top-right corner. Putting Comms at the far right puts that badge at the control's own
 * end, rather than pinned to a corner in the middle of the row. The badge used to live inline on
 * the sidebar's Queue link instead (`comms-nav.tsx`) — ALF-222 moved it here so the count is
 * visible from every module, not only once Comms is already open.
 *
 * The badge pokes slightly OUTSIDE the segment's own corner (negative offsets), the same way a
 * notification badge conventionally overlaps its host icon.
 */
const segmentClass = (module: ModuleId, active: boolean) =>
  cn(
    // `flex-1` (basis: 0) — every segment is the same width regardless of module, so the icon a
    // user clicked never moves when another module is opened (ALF-270). `min-w-0` is still the
    // floor: a sixth module narrows every cell instead of overflowing the control.
    'relative flex-1 min-w-0 flex items-center justify-center rounded-md py-1.5',
    'transition-colors duration-100 motion-reduce:transition-none',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    active
      ? cn('bg-surface shadow-[0_1px_2px_0_rgba(0,0,0,0.4)]', MODULE_ACCENT[module].text)
      : 'text-muted-foreground hover:text-foreground',
  );

/**
 * The corner badge's own classes. Negative insets deliberately poke it outside the segment's own
 * box, the same way a notification badge conventionally overlaps its host icon.
 */
const queueBadgeClass =
  'absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface px-0.5 py-0 text-[9px] leading-none';

/** Each segment: the module it selects and the view it lands on, in display order. */
const SEGMENTS: readonly { module: ModuleId; href: string }[] = [
  { module: 'tasks', href: '/priority' },
  { module: 'code', href: '/code' },
  { module: 'reader', href: '/reader' },
  { module: 'wiki', href: '/wiki' },
  // Comms stays last so its badge sits at the row's end, not a corner in the middle.
  { module: 'comms', href: '/comms' },
];

export function ViewSwitcher() {
  const current = activeModule(usePathname());
  const queued = useQueueCount();

  return (
    <div
      role="group"
      aria-label="Switch module"
      className="flex w-full items-center gap-0.5 rounded-lg border border-border bg-background/60 p-1"
    >
      {SEGMENTS.map(({ module, href }) => {
        const Icon = MODULE_ICON[module];
        const label = MODULE_LABEL[module];
        return (
          <ViewLink
            key={module}
            href={href}
            aria-current={current === module ? 'page' : undefined}
            aria-label={label}
            title={label}
            className={segmentClass(module, current === module)}
          >
            <Icon size={16} aria-hidden />
            {module === 'comms' && (
              <FolderCountBadge
                tone="attention"
                count={queued}
                label={(count) => `${String(count)} waiting for a reply`}
                className={queueBadgeClass}
              />
            )}
          </ViewLink>
        );
      })}
    </div>
  );
}
