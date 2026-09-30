'use client';

import { Search } from 'lucide-react';
import * as React from 'react';

import { Input } from '@/components/atoms/input';

import { WikiSearchResults } from './wiki-search-results';

interface WikiSearchableProperties {
  /** What the view shows while the search box is empty. */
  children: React.ReactNode;
}

/**
 * The search box every list view of the wiki opens with, over what that view shows. Typing
 * searches the whole wiki, whichever view the box sits on, and swaps the view's content for the
 * results; clearing the box brings the content back. The content is unmounted while a query is
 * in, so anything it holds (the landing's web) starts afresh when it returns.
 */
export function WikiSearchable({ children }: WikiSearchableProperties) {
  const [query, setQuery] = React.useState('');

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
      {query.trim() === '' ? children : <WikiSearchResults query={query} />}
    </div>
  );
}
