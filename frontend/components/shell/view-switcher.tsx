'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { FolderCountBadge } from '@/components/tasks/folder-count-badge';
import { ViewLink } from '@/components/tasks/view-link';
import { MODULE_ACCENT, type ModuleId, activeModule } from '@/lib/modules';
import { useQueueCount } from '@/lib/stores/comms-store';
import { cn } from '@/lib/utils';

/**
 * The module switcher — a segmented control styled after the Claude desktop app. Each segment
 * navigates to one module's default view (Tasks → `/priority`, Code → `/code`, Comms →
 * `/comms`); the active segment is derived from the route through the shared `activeModule`
 * rule, so URL, content, sidebar, and switcher highlight never disagree.
 *
 * The active segment wears its OWN module's accent, read from the shared accent table rather
 * than hard-coded — Tasks amber, Code teal, Comms blue, Reader green, no two alike (ALF-219).
 * One table means the switcher, the sidebar and a view heading can't drift on what colour a
 * module is.
 *
 * The control fills its container and splits that width evenly between the segments, rather than
 * sizing itself to its labels. Hugging the labels (`w-fit`, ALF-93) was fine with two segments
 * and burst the 224px desktop sidebar once Comms made three: the control ran past the sidebar's
 * border and over the main pane. Sized from the container down, a fourth module narrows the
 * segments instead of overflowing, so the layout can't break again from a label's width.
 *
 * Four segments needed more than that narrowing, though (ALF-233): measured in the
 * bundled Geist at 14px/500, "Tasks Code Comms Reader" is 181px of text against the 224px
 * sidebar's ~176px budget for all four segments — no padding change closes that gap without
 * truncating a label, which ALF-219 already ruled out. So the desktop sidebar widens to 256px
 * (`app-shell.tsx`, `md:w-64`) AND the segment type drops from 14px to 13px
 * (`text-[13px] px-1`, down from `text-sm px-1.5`): at 256px the four 13px labels measure 161px
 * against a 208px budget, ~15px of slack — comfortably clear of a font-hinting difference.
 * Everything else about the control (`flex-auto`, `min-w-0`, `truncate` as the floor, `gap-0.5`,
 * `p-1`) is unchanged.
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
 * notification badge conventionally overlaps its host icon, rather than trying to squeeze inside
 * the segment next to the label — the segment is only ~13px of text tall with 4px of padding, so
 * any inside-the-box position collides with the label's own cap-height (measured in Storybook: it
 * covered part of the final "s"). That only works because `truncate` (the text-clipping
 * `overflow-hidden`) moved off this anchor and onto an inner span wrapping just the label text —
 * left on the anchor, it would clip the badge's overhang along with any overflowing text.
 */
const segmentClass = (module: ModuleId, active: boolean) =>
  cn(
    // `flex-auto` (basis: content), not `flex-1` (basis: 0): each segment starts at its own
    // label's width and only the LEFTOVER space is shared out. Equal thirds would hand every
    // segment what the narrowest needs and clip "Comms" at the sidebar's width. `min-w-0` is the
    // floor under that: a fourth module shrinks below its label's width inside the control rather
    // than push it past the sidebar border, which is the failure mode being fixed.
    'relative flex-auto min-w-0 rounded-md px-1 py-1 text-center text-[13px] font-medium',
    'transition-colors duration-100 motion-reduce:transition-none',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    active
      ? cn('bg-surface shadow-[0_1px_2px_0_rgba(0,0,0,0.4)]', MODULE_ACCENT[module].text)
      : 'text-muted-foreground hover:text-foreground',
  );

/**
 * The label text's own clipping — `truncate` moved here (off the anchor) so the corner badge,
 * an absolutely-positioned sibling, isn't clipped by the same `overflow-hidden`. A plain `block`
 * child fills its flex-item parent's width without needing its own `min-w-0`: that escape hatch
 * is specifically for flex/grid items defaulting to `min-width: auto`, and this span is neither.
 */
const labelClass = 'block truncate';

/**
 * The corner badge's own classes. Negative insets deliberately poke it outside the segment's own
 * box — see the component doc comment for why that needs `truncate` off the anchor first.
 */
const queueBadgeClass =
  'absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface px-0.5 py-0 text-[9px] leading-none';

/** Each segment: the module it selects, its label, and the view it lands on. */
const SEGMENTS: readonly { module: ModuleId; label: string; href: string }[] = [
  { module: 'tasks', label: 'Tasks', href: '/priority' },
  { module: 'code', label: 'Code', href: '/code' },
  { module: 'reader', label: 'Reader', href: '/reader' },
  { module: 'comms', label: 'Comms', href: '/comms' },
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
      {SEGMENTS.map(({ module, label, href }) => (
        <ViewLink
          key={module}
          href={href}
          aria-current={current === module ? 'page' : undefined}
          className={segmentClass(module, current === module)}
        >
          <span className={labelClass}>{label}</span>
          {module === 'comms' && (
            <FolderCountBadge
              tone="attention"
              count={queued}
              label={(count) => `${String(count)} waiting for a reply`}
              className={queueBadgeClass}
            />
          )}
        </ViewLink>
      ))}
    </div>
  );
}
