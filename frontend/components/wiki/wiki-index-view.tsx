'use client';

import { Search } from 'lucide-react';
import * as React from 'react';

import { Input } from '@/components/atoms/input';
import { useWikiPages } from '@/lib/stores/wiki-store';
import { WIKI_SECTIONS, WIKI_SECTION_LABELS, type WikiSection } from '@/lib/wiki/sections';

import { WikiPageGroup } from './wiki-page-group';
import { WikiPageRow } from './wiki-page-row';
import { WikiSearchResults } from './wiki-search-results';
import { statusLineClass } from './wiki.styles';

interface WikiIndexViewProperties {
  /** One section only (`/wiki/<section>`); every section when absent (`/wiki`). */
  section?: WikiSection | undefined;
}

/**
 * The index and a section view: the search box over the pages grouped by section, in the wiki's
 * own order. A section view is the index filtered to one section, and its search box still
 * searches the whole wiki — typing replaces the list with the results.
 */
export function WikiIndexView({ section }: WikiIndexViewProperties) {
  const pages = useWikiPages();
  const [query, setQuery] = React.useState('');

  const sections = section === undefined ? WIKI_SECTIONS : [section];
  const groups = sections
    .map((name) => ({ name, pages: pages.filter((page) => page.section === name) }))
    // The index skips an empty section; a section view always shows its own.
    .filter((group) => section !== undefined || group.pages.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search the wiki"
          placeholder="Search the wiki"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="pl-9"
        />
      </div>
      {query.trim() === '' ? (
        groups.map((group) => (
          <WikiPageGroup
            key={group.name}
            title={WIKI_SECTION_LABELS[group.name].plural}
            count={group.pages.length}
          >
            {group.pages.length === 0 ? (
              <p className={statusLineClass}>
                No {WIKI_SECTION_LABELS[group.name].plural.toLowerCase()} yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {group.pages.map((page) => (
                  <WikiPageRow key={page.path} page={page} />
                ))}
              </ul>
            )}
          </WikiPageGroup>
        ))
      ) : (
        <WikiSearchResults query={query} />
      )}
    </div>
  );
}
