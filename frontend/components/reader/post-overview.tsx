import * as React from 'react';

import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';
import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';

import { NovelIdeaList } from './novel-idea-list';

/**
 * The four sections of a `done` post's structured take, in the order the model returns them and
 * the list draws them. An empty list is a valid, and honest, answer in both sections that have
 * one — the post restates what a well-read reader already knows, or argues with nothing to
 * point at — so each renders as a stated line rather than a blank section, which would read as
 * a bug rather than a verdict.
 *
 * Where this deployment can write into the wiki, Novel ideas becomes a checklist that sends
 * picked bullets there ({@link NovelIdeaList}). Everywhere else — the Work instance, or a post
 * with no novel ideas — the section, like the other three, is exactly the plain list it always
 * was.
 */

const BULLET_LIST_CLASS = 'mt-1 list-disc space-y-1 pl-5 text-sm text-foreground';
const PARAGRAPH_CLASS = 'mt-1 text-sm text-foreground';

const EMPTY_NOVEL_IDEAS_LINE =
  'Nothing new — the post restates what a well-read reader already knows.';

const EMPTY_EVIDENCE_LINE = 'None — the post rests on assertion alone.';

export interface PostOverviewProperties {
  overview: ReaderOverview;
  /** The post the overview belongs to — what a wiki send names and reads its sent marks from. */
  post: ReaderPostListItem;
  /** Whether this deployment can write into the wiki. */
  writable: boolean;
}

export function PostOverview({ overview, post, writable }: PostOverviewProperties) {
  const novelHeading = <h3 className={SECTION_HEADING_CLASS}>Novel ideas</h3>;
  const checklist = writable && overview.novel_ideas.length > 0;
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-3">
      <section>
        {checklist ? (
          <NovelIdeaList
            postId={post.id}
            ideas={overview.novel_ideas}
            sentIdeas={post.wiki_sent_ideas}
            heading={novelHeading}
          />
        ) : (
          <>
            {novelHeading}
            {overview.novel_ideas.length === 0 ? (
              <p className={PARAGRAPH_CLASS}>{EMPTY_NOVEL_IDEAS_LINE}</p>
            ) : (
              <ul className={BULLET_LIST_CLASS}>
                {overview.novel_ideas.map((idea, index) => (
                  <li key={index}>{idea}</li>
                ))}
              </ul>
            )}
          </>
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
