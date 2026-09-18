import * as React from 'react';

import type { ReaderOverview } from '@/lib/types';

/**
 * The four sections of a `done` post's structured take, in the order the model returns them and
 * the list draws them. An empty list is a valid, and honest, answer in both sections that have
 * one — the post restates what a well-read reader already knows, or argues with nothing to
 * point at — so each renders as a stated line rather than a blank section, which would read as
 * a bug rather than a verdict.
 */

const SECTION_HEADING_CLASS =
  'text-xs font-semibold uppercase tracking-widest text-muted-foreground';
const BULLET_LIST_CLASS = 'mt-1 list-disc space-y-1 pl-5 text-sm text-foreground';
const PARAGRAPH_CLASS = 'mt-1 text-sm text-foreground';

const EMPTY_NOVEL_IDEAS_LINE =
  'Nothing new — the post restates what a well-read reader already knows.';

const EMPTY_EVIDENCE_LINE = 'None — the post rests on assertion alone.';

export interface PostOverviewProperties {
  overview: ReaderOverview;
}

export function PostOverview({ overview }: PostOverviewProperties) {
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-3">
      <section>
        <h3 className={SECTION_HEADING_CLASS}>Novel ideas</h3>
        {overview.novel_ideas.length === 0 ? (
          <p className={PARAGRAPH_CLASS}>{EMPTY_NOVEL_IDEAS_LINE}</p>
        ) : (
          <ul className={BULLET_LIST_CLASS}>
            {overview.novel_ideas.map((idea, index) => (
              <li key={index}>{idea}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={SECTION_HEADING_CLASS}>Evidence</h3>
        {overview.evidence.length === 0 ? (
          <p className={PARAGRAPH_CLASS}>{EMPTY_EVIDENCE_LINE}</p>
        ) : (
          <ul className={BULLET_LIST_CLASS}>
            {overview.evidence.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={SECTION_HEADING_CLASS}>The argument</h3>
        <p className={PARAGRAPH_CLASS}>{overview.argument}</p>
      </section>

      <section>
        <h3 className={SECTION_HEADING_CLASS}>Who should read it</h3>
        <p className={PARAGRAPH_CLASS}>{overview.who_should_read}</p>
      </section>
    </div>
  );
}
