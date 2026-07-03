'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ViewLink } from '@/components/tasks/view-link';
import { isCodePath } from '@/lib/modules';
import { cn } from '@/lib/utils';

/**
 * The Tasks ⇄ Code module switcher — a two-button segmented control styled after the
 * Claude desktop app. Each segment navigates between the two modules (Tasks → `/`,
 * Code → `/code`); the active segment is derived from the route via the shared `isCodePath`
 * rule, so URL, content, sidebar, and switcher highlight never disagree.
 *
 * Since ALF-27 both modules are seeded under one shared shell layout, so switching modules no
 * longer needs an RSC navigation: this uses `ViewLink` (the History-API switch the in-module
 * views already use), NOT `next/link`. A plain primary click is a `history.pushState` — no
 * document reload, no `?_rsc=` round-trip — and every page renders the same URL-deriving
 * `ModuleRouter`, so the view follows the new URL. The segments stay real `<a href>`s:
 * modified/middle clicks and hard loads navigate natively, and keyboard users get real links.
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
  const codeActive = isCodePath(pathname);
  const tasksActive = !codeActive;

  // exactOptionalPropertyTypes: only forward onClick when a handler was given.
  const navigateProperty = onNavigate ? { onClick: onNavigate } : {};

  return (
    <div
      role="group"
      aria-label="Switch module"
      className="flex w-fit items-center gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      <ViewLink
        href="/"
        aria-current={tasksActive ? 'page' : undefined}
        className={segmentClass(tasksActive)}
        {...navigateProperty}
      >
        Tasks
      </ViewLink>
      <ViewLink
        href="/code"
        aria-current={codeActive ? 'page' : undefined}
        className={segmentClass(codeActive)}
        {...navigateProperty}
      >
        Code
      </ViewLink>
    </div>
  );
}
