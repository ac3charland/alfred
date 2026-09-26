import * as React from 'react';

import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';

import { groupCountClass } from './wiki.styles';

interface WikiPageGroupProperties {
  /** The heading — a section's plural name, a search group's name. Also the group's label. */
  title: string;
  /** A count beside the heading (the index's sections carry one). */
  count?: number;
  children: React.ReactNode;
}

/** A headed group of page rows: a labelled region, so each list is reachable by its name. */
export function WikiPageGroup({ title, count, children }: WikiPageGroupProperties) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className={`px-3 ${SECTION_HEADING_CLASS}`}>
        {title}
        {count === undefined ? null : <span className={groupCountClass}>{count}</span>}
      </h3>
      {children}
    </section>
  );
}
