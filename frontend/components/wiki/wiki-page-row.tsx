import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { ViewLink } from '@/components/tasks/view-link';
import type { WikiPageIndexRow } from '@/lib/types';
import { WIKI_SECTION_LABELS, isWikiSection, wikiPageHref } from '@/lib/wiki/sections';
import { splitSnippet } from '@/lib/wiki/snippet';

import {
  pageRowClass,
  pageRowSummaryClass,
  pageRowTitleClass,
  snippetMarkClass,
} from './wiki.styles';

interface WikiPageRowProperties {
  page: WikiPageIndexRow;
  /** Show the page's section as a chip — search results span the whole wiki. */
  showSection?: boolean;
  /**
   * A body-search snippet to show in place of the summary, its matched words marked. Plain text
   * runs only: the markers are control characters, and nothing from the server is injected.
   */
  snippet?: string;
}

/** A snippet's text with each matched run in a `<mark>`. */
function Snippet({ snippet }: { snippet: string }) {
  return (
    <>
      {splitSnippet(snippet).map((part, index) =>
        part.marked ? (
          <mark key={index} className={snippetMarkClass}>
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/**
 * One page in a list — the index, a section, either search group, "Linked from": the title over
 * its summary (or a search snippet), the whole row an in-app link to the page.
 */
export function WikiPageRow({ page, showSection = false, snippet }: WikiPageRowProperties) {
  return (
    <li>
      <ViewLink href={wikiPageHref(page.path)} className={pageRowClass}>
        <span className={pageRowTitleClass}>
          {page.title}
          {showSection && isWikiSection(page.section) ? (
            <Badge variant="muted" className="font-normal">
              {WIKI_SECTION_LABELS[page.section].singular}
            </Badge>
          ) : null}
        </span>
        {snippet === undefined ? (
          page.summary === '' ? null : (
            <span className={`block ${pageRowSummaryClass}`}>{page.summary}</span>
          )
        ) : (
          <span className={`block ${pageRowSummaryClass}`}>
            <Snippet snippet={snippet} />
          </span>
        )}
      </ViewLink>
    </li>
  );
}
