'use client';

import { Library } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ViewLink } from '@/components/tasks/view-link';
import { useWikiCounts } from '@/lib/stores/wiki-store';
import { navLinkClass } from '@/lib/ui/nav-link-class';
import { WIKI_SECTIONS, WIKI_SECTION_LABELS } from '@/lib/wiki/sections';

import { WIKI_SECTION_ICONS } from './wiki-section-icons';

interface WikiNavProperties {
  /** Called after a nav link is clicked (e.g. to close the mobile drawer). */
  onClose?: () => void;
}

/**
 * A muted tally beside a nav label; nothing at zero, so an empty wiki stays clean. A visually
 * hidden `sr-only` suffix gives a screen reader "12 pages" rather than the bare digits — real
 * text in the accessible name, not `aria-label` on this role-less span: an ARIA-prohibited
 * attribute here that would also silently overwrite the whole link's accessible name instead of
 * extending it.
 */
function Count({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
      {value}
      <span className="sr-only">{` page${value === 1 ? '' : 's'}`}</span>
    </span>
  );
}

/**
 * Wiki-module sidebar navigation: the whole index, then the four sections, each with how many
 * pages it holds. The `aria-label` ("Wiki") is what the shell's tests and the E2E spec key on,
 * kept distinct from "Reader", "Comms" and "Projects". The counts are read straight off the
 * seeded index, so they move with a refresh and never with a fetch of their own.
 */
export function WikiNav({ onClose }: WikiNavProperties) {
  const pathname = usePathname();
  const counts = useWikiCounts();
  // "All pages" is active only at the module root — a section's own page routes (below) must
  // NOT also light it up. A section link, in contrast, stays active on its page routes too
  // (`/wiki/concepts/x`), the way the other modules' section links do.
  const isRootActive = (path: string) => pathname === path;
  const isSectionActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  // exactOptionalPropertyTypes: only spread the handler when one was given.
  const closeProperty = onClose ? { onClick: onClose } : {};

  return (
    <nav aria-label="Wiki" className="flex flex-col gap-1 py-2">
      <ViewLink href="/wiki" className={navLinkClass(isRootActive('/wiki'))} {...closeProperty}>
        <Library size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">All pages</span>
        <Count value={counts.all} />
      </ViewLink>

      {WIKI_SECTIONS.map((section) => {
        const Icon = WIKI_SECTION_ICONS[section];
        const href = `/wiki/${section}`;
        return (
          <ViewLink
            key={section}
            href={href}
            className={navLinkClass(isSectionActive(href))}
            {...closeProperty}
          >
            <Icon size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{WIKI_SECTION_LABELS[section].plural}</span>
            <Count value={counts[section]} />
          </ViewLink>
        );
      })}
    </nav>
  );
}
