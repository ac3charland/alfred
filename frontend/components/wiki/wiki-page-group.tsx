import * as React from 'react';

import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';

import { groupCountClass } from './wiki.styles';

interface WikiPageGroupProperties {
  /** The heading — a section's plural name, a search group's name. Also the group's label. */
  title: string;
  /** A count beside the heading (the index's sections carry one). */
  count?: number;
  /**
   * The heading's id, when something inside the group is labelled by it too (the landing's web);
   * a generated one otherwise.
   */
  headingId?: string | undefined;
  children: React.ReactNode;
}

/** A headed group of page rows: a labelled region, so each list is reachable by its name. */
export function WikiPageGroup({ title, count, headingId, children }: WikiPageGroupProperties) {
  const generatedId = React.useId();
  const id = headingId ?? generatedId;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h3 id={id} className={`px-3 ${SECTION_HEADING_CLASS}`}>
        {title}
        {count === undefined ? null : <span className={groupCountClass}>{count}</span>}
      </h3>
      {children}
    </section>
  );
}
