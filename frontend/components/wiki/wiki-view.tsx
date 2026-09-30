'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { EmptyState } from '@/components/atoms/empty-state';
import { ViewLink } from '@/components/tasks/view-link';
import { useNow } from '@/lib/hooks/use-now';
import { useWikiActions, useWikiPages } from '@/lib/stores/wiki-store';

import { WikiHeader } from './wiki-header';
import { WikiLandingView } from './wiki-landing-view';
import { WikiPageView } from './wiki-page-view';
import { parseWikiRoute } from './wiki-route';
import { WikiSectionView } from './wiki-section-view';
import { backLinkClass } from './wiki.styles';

/** The module's root; everything else hangs off it as `/wiki/<section>[/<name>]`. */
export const WIKI_PREFIX = '/wiki';

interface WikiViewProperties {
  /**
   * The clock the header's "synced 2h ago" and the landing's concept of the day read. Defaults to
   * the live, ticking clock; stories and tests pin it, since a relative time or a day's pick read
   * off the real clock can't be asserted or snapshotted.
   */
  now?: Date | undefined;
  /**
   * Force the landing web's reduced-motion path — stories and tests, which need it settled in one
   * paint. Omitted, the web follows `prefers-reduced-motion`.
   */
  reducedMotion?: boolean | undefined;
}

/**
 * Client-side view router for the Wiki module — the counterpart to `TaskViews` / `CodeView` /
 * `CommsView` / `ReaderView`. Every Wiki page renders this one component, which derives the
 * view purely from the URL, the same `pushState`-driven pattern the other modules use: the
 * landing, one section, one page, or not found.
 *
 * The store re-reads the snapshot when the tab returns, but that never fires on an in-app
 * navigation (the document never hides), so every navigation within the module — keyed on
 * `pathname`, which also covers entry — triggers the same coalesced `refresh()` (the
 * navigation-refetch pattern). It swallows its own errors, so it never blocks the view.
 */
export function WikiView({ now, reducedMotion }: WikiViewProperties) {
  const pathname = usePathname();
  const { refresh } = useWikiActions();
  const pages = useWikiPages();
  const liveNow = useNow();

  React.useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  const index = React.useMemo(() => new Set(pages.map((page) => page.path)), [pages]);
  const route = parseWikiRoute(pathname, index);
  const clock = now ?? liveNow;

  return (
    <div className="flex flex-col gap-6">
      <WikiHeader now={clock} />
      {pages.length === 0 ? (
        <EmptyState
          title="Nothing synced yet"
          description="Pages appear here after the wiki's next push reaches Alfred."
        />
      ) : route.kind === 'index' ? (
        <WikiLandingView now={clock} reducedMotion={reducedMotion} />
      ) : route.kind === 'section' ? (
        <WikiSectionView section={route.section} />
      ) : route.kind === 'page' ? (
        <WikiRoutedPage path={route.path} />
      ) : (
        <EmptyState
          title="No page at this path"
          description="It may have been renamed or removed in the wiki."
          action={
            <ViewLink href={WIKI_PREFIX} className={backLinkClass}>
              Back to the wiki
            </ViewLink>
          }
        />
      )}
    </div>
  );
}

/** The routed page, keyed by path so moving between pages starts each one fresh. */
function WikiRoutedPage({ path }: { path: string }) {
  const pages = useWikiPages();
  const page = pages.find((candidate) => candidate.path === path);
  return page === undefined ? null : <WikiPageView key={page.path} page={page} />;
}
