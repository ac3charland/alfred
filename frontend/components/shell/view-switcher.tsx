'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ViewLink } from '@/components/tasks/view-link';
import { MODULE_ACCENT, type ModuleId, activeModule } from '@/lib/modules';
import { cn } from '@/lib/utils';

/**
 * The module switcher — a segmented control styled after the Claude desktop app. Each segment
 * navigates to one module's default view (Tasks → `/priority`, Code → `/code`, Comms →
 * `/comms`); the active segment is derived from the route through the shared `activeModule`
 * rule, so URL, content, sidebar, and switcher highlight never disagree.
 *
 * The active segment wears its OWN module's accent, read from the shared accent table rather
 * than hard-coded — Tasks is amber, Code teal, Comms blue. One table means the switcher, the
 * sidebar and a view heading can't drift on what colour a module is.
 *
 * It is a FULL-WIDTH control of equal segments, not one that hugs its content. The desktop
 * sidebar is a fixed 224px with 16px of padding a side, so a content-sized control overflowed
 * its right border once Comms made a third segment (ALF-219). Equal thirds fit that width by
 * construction and would keep fitting if a fourth module arrived.
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
 * `min-w-0` on a segment is what makes those thirds real: a flex item's default
 * `min-width: auto` floors it at its label's min-content width, so `flex-1` alone would still
 * let "Comms" push the row wider than the sidebar — the very overflow being fixed.
 */
const segmentClass = (module: ModuleId, active: boolean) =>
  cn(
    'flex-1 min-w-0 rounded-md px-2 py-1 text-center text-xs font-medium',
    'transition-colors duration-100 motion-reduce:transition-none',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    active
      ? cn('bg-surface shadow-[0_1px_2px_0_rgba(0,0,0,0.4)]', MODULE_ACCENT[module].text)
      : 'text-muted-foreground hover:text-foreground',
  );

/** Each segment: the module it selects, its label, and the view it lands on. */
const SEGMENTS: readonly { module: ModuleId; label: string; href: string }[] = [
  { module: 'tasks', label: 'Tasks', href: '/priority' },
  { module: 'code', label: 'Code', href: '/code' },
  { module: 'comms', label: 'Comms', href: '/comms' },
];

export function ViewSwitcher() {
  const current = activeModule(usePathname());

  return (
    <div
      role="group"
      aria-label="Switch module"
      className="flex w-full items-center gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {SEGMENTS.map(({ module, label, href }) => (
        <ViewLink
          key={module}
          href={href}
          aria-current={current === module ? 'page' : undefined}
          className={segmentClass(module, current === module)}
        >
          {label}
        </ViewLink>
      ))}
    </div>
  );
}
