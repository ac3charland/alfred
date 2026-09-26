'use client';

import * as React from 'react';

import { Spinner } from '@/components/atoms/spinner';
import { useWikiPages } from '@/lib/stores/wiki-store';

import { useWikiBodySearch } from './use-wiki-body-search';
import { WikiPageGroup } from './wiki-page-group';
import { WikiPageRow } from './wiki-page-row';
import { bodyMatches, titleMatches } from './wiki-search';
import { statusLineClass } from './wiki.styles';

/**
 * What the search box finds, across the whole wiki whichever view it sits on: instant title,
 * summary and tag matches from the index, then body matches from Postgres with the matched words
 * marked, never repeating a page the first group already lists. A failed body search says so and
 * leaves the title matches standing.
 */
export function WikiSearchResults({ query }: { query: string }) {
  const pages = useWikiPages();
  const titles = React.useMemo(() => titleMatches(pages, query), [pages, query]);
  const body = useWikiBodySearch(query);

  const listed = React.useMemo(() => new Set(titles.map((page) => page.path)), [titles]);
  const bodyRows = React.useMemo(
    () => (body.status === 'ready' ? bodyMatches(body.hits, pages, listed) : []),
    [body, pages, listed],
  );

  const bodySettledEmpty =
    body.status === 'idle' || (body.status === 'ready' && bodyRows.length === 0);
  if (titles.length === 0 && bodySettledEmpty) {
    return <p className={statusLineClass}>No pages match “{query.trim()}”</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {titles.length === 0 ? null : (
        <WikiPageGroup title="Titles & summaries">
          <ul className="flex flex-col">
            {titles.map((page) => (
              <WikiPageRow key={page.path} page={page} showSection />
            ))}
          </ul>
        </WikiPageGroup>
      )}
      {body.status === 'idle' || (body.status === 'ready' && bodyRows.length === 0) ? null : (
        <WikiPageGroup title="In page text">
          {body.status === 'pending' ? (
            <p className={statusLineClass}>
              <Spinner label="Searching page text" />
              Searching page text…
            </p>
          ) : body.status === 'error' ? (
            <p className={statusLineClass}>Couldn&apos;t search page text</p>
          ) : (
            <ul className="flex flex-col">
              {bodyRows.map(({ page, snippet }) => (
                <WikiPageRow key={page.path} page={page} snippet={snippet} showSection />
              ))}
            </ul>
          )}
        </WikiPageGroup>
      )}
    </div>
  );
}
