'use client';

import * as React from 'react';

import { useWikiPages } from '@/lib/stores/wiki-store';
import { WIKI_SECTION_LABELS, type WikiSection } from '@/lib/wiki/sections';

import { WikiPageGroup } from './wiki-page-group';
import { WikiPageRow } from './wiki-page-row';
import { WikiSearchable } from './wiki-searchable';
import { statusLineClass } from './wiki.styles';

interface WikiSectionViewProperties {
  /** The section `/wiki/<section>` names. */
  section: WikiSection;
}

/**
 * One section's view: the search box over every page in that section, in the wiki's own order.
 * It is the one list of a section's pages — the landing draws concepts and entities as a web and
 * leaves sources and questions to the nav — so an empty section still shows its heading.
 */
export function WikiSectionView({ section }: WikiSectionViewProperties) {
  const pages = useWikiPages();
  const listed = pages.filter((page) => page.section === section);
  const { plural } = WIKI_SECTION_LABELS[section];

  return (
    <WikiSearchable>
      <WikiPageGroup title={plural} count={listed.length}>
        {listed.length === 0 ? (
          <p className={statusLineClass}>No {plural.toLowerCase()} yet.</p>
        ) : (
          <ul className="flex flex-col">
            {listed.map((page) => (
              <WikiPageRow key={page.path} page={page} />
            ))}
          </ul>
        )}
      </WikiPageGroup>
    </WikiSearchable>
  );
}
