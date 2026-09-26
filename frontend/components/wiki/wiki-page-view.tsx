'use client';

import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { Spinner } from '@/components/atoms/spinner';
import { ViewLink } from '@/components/tasks/view-link';
import { useWikiConfig, useWikiPageBody, useWikiPages } from '@/lib/stores/wiki-store';
import type { WikiPageIndexRow } from '@/lib/types';
import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';
import { resolveWikiSource } from '@/lib/wiki/links';
import { WIKI_SECTION_LABELS, isWikiSection } from '@/lib/wiki/sections';

import { formatWikiDate } from './wiki-format';
import { BROKEN_LINK_TITLE, OutboundMark, WikiMarkdown } from './wiki-markdown';
import { brokenLinkClass, wikiLinkClass } from './wiki-markdown.styles';
import { WikiPageGroup } from './wiki-page-group';
import { WikiPageRow } from './wiki-page-row';
import {
  backLinkClass,
  bodyStatusClass,
  eyebrowClass,
  pageTitleClass,
  statusLineClass,
} from './wiki.styles';

/** The URL's fragment as an element id, or '' when there is none. */
function currentHashId(): string {
  const hash = globalThis.location.hash.slice(1);
  try {
    return decodeURIComponent(hash);
  } catch {
    // A malformed escape: look the fragment up as written.
    return hash;
  }
}

/**
 * Where a page opens. With a `#anchor`, on that heading, once the body it points into has
 * rendered — a hard load's own scroll fires before the body exists, and a `pushState` into a page
 * never scrolls at all. Without one, at the top: a `pushState` keeps the scroll position, so
 * following a link from the foot of a long page would otherwise open the next one mid-way.
 */
function useScrollOnOpen(body: React.RefObject<HTMLElement | null>, ready: boolean, path: string) {
  React.useEffect(() => {
    if (currentHashId() === '') globalThis.scrollTo(0, 0);
  }, [path]);

  React.useEffect(() => {
    const id = currentHashId();
    if (!ready || id === '') return;
    body.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView();
  }, [body, ready, path]);
}

/** The body slot: the rendered page, or where its fetch is. The header above never waits on it. */
function WikiPageBody({ page }: { page: WikiPageIndexRow }) {
  const body = useWikiPageBody(page.path);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  useScrollOnOpen(bodyRef, body.status === 'ready', page.path);

  if (body.status === 'loading') {
    return (
      <p className={bodyStatusClass}>
        <Spinner label="Loading page" />
        Loading page…
      </p>
    );
  }
  if (body.status === 'error') {
    return (
      <EmptyState
        title="Couldn't load this page"
        action={
          <Button variant="outline" onClick={body.retry}>
            Retry
          </Button>
        }
      />
    );
  }
  return (
    <div ref={bodyRef}>
      <WikiMarkdown body={body.body} path={page.path} />
    </div>
  );
}

/** The frontmatter sources, each a GitHub link labelled `<folder> / <file>`. */
function WikiSources({ page }: { page: WikiPageIndexRow }) {
  const { repo } = useWikiConfig();
  if (page.sources.length === 0) return null;
  return (
    <section aria-label="Sources" className="flex flex-col gap-2">
      <h3 className={SECTION_HEADING_CLASS}>Sources</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {page.sources.map((source, index) => {
          const { label, href } = resolveWikiSource(source, page.path, repo);
          return (
            // A page may list one source twice; the position keeps the keys apart.
            <li key={`${String(index)}:${source}`} className="[overflow-wrap:anywhere]">
              {href === undefined ? (
                <span title={BROKEN_LINK_TITLE} className={brokenLinkClass}>
                  {label}
                </span>
              ) : (
                <a href={href} target="_blank" rel="noopener noreferrer" className={wikiLinkClass}>
                  {label}
                  <OutboundMark />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Every page whose outbound links name this one, in index order. */
function WikiBacklinks({ page }: { page: WikiPageIndexRow }) {
  const pages = useWikiPages();
  const linking = pages.filter(
    (candidate) => candidate.path !== page.path && candidate.links.includes(page.path),
  );
  // Pulled out by the rows' own inset, so their text lines up with the body and Sources above.
  return (
    <div className="-mx-3">
      <WikiPageGroup title="Linked from">
        {linking.length === 0 ? (
          <p className={statusLineClass}>No other page links here yet.</p>
        ) : (
          <ul className="flex flex-col">
            {linking.map((candidate) => (
              <WikiPageRow key={candidate.path} page={candidate} />
            ))}
          </ul>
        )}
      </WikiPageGroup>
    </div>
  );
}

/**
 * One page, top to bottom: the way back to its section, the section eyebrow, the title and
 * summary, tags and date, the body, its sources, and the pages that link to it. Everything but
 * the body draws from the index, so the page's header is on screen while its body loads or fails.
 */
export function WikiPageView({ page }: { page: WikiPageIndexRow }) {
  const labels = isWikiSection(page.section) ? WIKI_SECTION_LABELS[page.section] : undefined;
  const updated = formatWikiDate(page.updated);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <ViewLink href={`/wiki/${page.section}`} className={backLinkClass}>
          <span aria-hidden="true">← </span>
          {labels?.plural ?? 'Wiki'}
        </ViewLink>
        {labels === undefined ? null : <p className={eyebrowClass}>{labels.singular}</p>}
        <h3 className={pageTitleClass}>{page.title}</h3>
        {page.summary === '' ? null : (
          <p className="text-base text-muted-foreground">{page.summary}</p>
        )}
        {page.tags.length === 0 && updated === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {page.tags.map((tag) => (
              <Badge key={tag} variant="muted">
                {tag}
              </Badge>
            ))}
            {updated === undefined ? null : (
              <span className="text-xs text-muted-foreground">Updated {updated}</span>
            )}
          </div>
        )}
      </header>
      <WikiPageBody page={page} />
      <footer className="flex flex-col gap-6 border-t border-border/60 pt-6">
        <WikiSources page={page} />
        <WikiBacklinks page={page} />
      </footer>
    </article>
  );
}
