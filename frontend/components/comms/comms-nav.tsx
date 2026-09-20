'use client';

import { BookMarked, Inbox, ScrollText, Users } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ViewLink } from '@/components/tasks/view-link';
import { navLinkClass } from '@/lib/ui/nav-link-class';

interface CommsNavProperties {
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

/**
 * Comms-module sidebar navigation. The Queue leads — it is the module's default view —
 * followed by the three surfaces the owner edits by hand: the people list, the rubric, and the
 * example set the corrections double as.
 *
 * The queue count used to badge this Queue link; ALF-222 moved it onto the Comms segment of the
 * module switcher instead, so it reads from every module rather than only once Comms is open.
 */
export function CommsNav({ onClose }: CommsNavProperties) {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path;
  // exactOptionalPropertyTypes: only spread the handler when one was given.
  const closeProperty = onClose ? { onClick: onClose } : {};

  return (
    <nav aria-label="Comms" className="flex flex-col gap-1 py-2">
      <ViewLink href="/comms" className={navLinkClass(isActive('/comms'))} {...closeProperty}>
        <Inbox size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">Queue</span>
      </ViewLink>

      <ViewLink
        href="/comms/people"
        className={navLinkClass(isActive('/comms/people'))}
        {...closeProperty}
      >
        <Users size={15} className="shrink-0" />
        <span>People</span>
      </ViewLink>

      <ViewLink
        href="/comms/rubric"
        className={navLinkClass(isActive('/comms/rubric'))}
        {...closeProperty}
      >
        <ScrollText size={15} className="shrink-0" />
        <span>Rubric</span>
      </ViewLink>

      <ViewLink
        href="/comms/examples"
        className={navLinkClass(isActive('/comms/examples'))}
        {...closeProperty}
      >
        <BookMarked size={15} className="shrink-0" />
        <span>Examples</span>
      </ViewLink>
    </nav>
  );
}
