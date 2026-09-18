'use client';

import { Archive, BookOpen, Newspaper } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { FolderCountBadge } from '@/components/tasks/folder-count-badge';
import { ViewLink } from '@/components/tasks/view-link';
import { useActiveCount } from '@/lib/stores/reader-store';
import { navLinkClass } from '@/lib/ui/nav-link-class';

interface ReaderNavProperties {
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

/**
 * Reader-module sidebar navigation: the reading list, the archive and the publications roster —
 * the three segments the shell's route group serves. The `aria-label` ("Reader") is what
 * both the shell's own tests and the E2E spec key on, kept distinct from "Comms" and "Projects".
 *
 * The Reading list link carries the count of unarchived posts, whatever their summary state —
 * the same number the list's heading reads out — and hides it at zero, exactly like the Comms
 * queue badge: an empty list is the module's resting state, not a number to read past.
 */
export function ReaderNav({ onClose }: ReaderNavProperties) {
  const pathname = usePathname();
  const toRead = useActiveCount();
  const isActive = (path: string) => pathname === path;
  // exactOptionalPropertyTypes: only spread the handler when one was given.
  const closeProperty = onClose ? { onClick: onClose } : {};

  return (
    <nav aria-label="Reader" className="flex flex-col gap-1 py-2">
      <ViewLink href="/reader" className={navLinkClass(isActive('/reader'))} {...closeProperty}>
        <BookOpen size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">Reading list</span>
        <FolderCountBadge
          tone="attention"
          count={toRead}
          label={(count) => `${String(count)} to read`}
        />
      </ViewLink>

      <ViewLink
        href="/reader/archive"
        className={navLinkClass(isActive('/reader/archive'))}
        {...closeProperty}
      >
        <Archive size={15} className="shrink-0" />
        <span>Archive</span>
      </ViewLink>

      <ViewLink
        href="/reader/publications"
        className={navLinkClass(isActive('/reader/publications'))}
        {...closeProperty}
      >
        <Newspaper size={15} className="shrink-0" />
        <span>Publications</span>
      </ViewLink>
    </nav>
  );
}
