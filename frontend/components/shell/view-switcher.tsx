'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The Tasks ⇄ Code module switcher — a two-button segmented control styled after the
 * Claude desktop app. Each segment navigates between the two route groups (Tasks → `/`,
 * Code → `/code`); the active segment is derived from the route.
 *
 * Uses `next/link`, NOT the in-group `ViewLink`: switching modules crosses route groups
 * (`(tasks)` ⇄ `(code)`), each with its own layout + providers, so it needs a real RSC
 * navigation to mount the target module — `ViewLink`'s `history.pushState` only re-derives
 * views already mounted in the *same* group (the inbox/folder/completed switch), and would
 * change the URL without ever loading the other module.
 *
 * "Code" is active on any `/code` path (the landing or a project board); "Tasks" is active
 * everywhere else (inbox, a folder, completed). The track is one bordered pill; the active
 * segment lifts onto the surface with the teal accent, the inactive one stays muted.
 *
 * `prefetch={false}`: the switcher is always on screen, so default prefetch would fire an
 * RSC request for the other module on every page — needless for two top-level destinations,
 * and it would pollute the "no round-trip on a client view switch" guarantee the tasks views
 * rely on. A click still navigates normally.
 */
const segmentClass = (active: boolean) =>
  cn(
    'rounded-md px-3 py-1 text-sm font-medium transition-colors duration-100 motion-reduce:transition-none',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
    active
      ? 'bg-surface text-accent-teal shadow-[0_1px_2px_0_rgba(0,0,0,0.4)]'
      : 'text-muted-foreground hover:text-foreground',
  );

interface ViewSwitcherProperties {
  /** Called after a segment is clicked (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
}

export function ViewSwitcher({ onNavigate }: ViewSwitcherProperties) {
  const pathname = usePathname();
  const codeActive = pathname === '/code' || pathname.startsWith('/code/');
  const tasksActive = !codeActive;

  // exactOptionalPropertyTypes: only forward onClick when a handler was given.
  const navigateProperty = onNavigate ? { onClick: onNavigate } : {};

  return (
    <div
      role="group"
      aria-label="Switch module"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      <Link
        href="/"
        prefetch={false}
        aria-current={tasksActive ? 'page' : undefined}
        className={segmentClass(tasksActive)}
        {...navigateProperty}
      >
        Tasks
      </Link>
      <Link
        href="/code"
        prefetch={false}
        aria-current={codeActive ? 'page' : undefined}
        className={segmentClass(codeActive)}
        {...navigateProperty}
      >
        Code
      </Link>
    </div>
  );
}
