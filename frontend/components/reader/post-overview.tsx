import * as React from 'react';

import { furtherReadingOf, isBullet } from '@/lib/reader/overview';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';
import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';

import { FurtherReading } from './further-reading';
import { plainBulletListClass } from './reader-checklist.styles';
import { WikiPicks } from './wiki-picks';

/**
 * The sections of a `done` post's structured take, in the order the model returns them and the
 * list draws them: Novel ideas, Evidence, The argument, Who should read it, and — last, and only
 * when the summary has one — Further reading. An empty list is a valid, and honest, answer in both
 * bullet sections — the post restates what a well-read reader already knows, or argues with
 * nothing to point at — so each renders as a stated line rather than a blank section, which would
 * read as a bug rather than a verdict.
 *
 * Where this deployment can write into the wiki, Novel ideas and Evidence become checklists over
 * one selection that sends picked bullets there ({@link WikiPicks}); each section is a checklist
 * only when it has a bullet to pick, and the pair is handed over when either is. Everywhere
 * else — a deployment with no wiki token, or a post with neither — both sections, like the other
 * two, are exactly the plain lists they always were. A bullet that is empty or only whitespace is
 * no bullet, so neither view draws it: a list of nothing else reads as the honest empty line, never as a checklist with
 * nothing to tick ("All sent to wiki").
 *
 * Further reading ({@link FurtherReading}) closes the panel, below the take itself and apart from
 * the wiki picks, because its sends go somewhere else (Instapaper, not the wiki). Unlike the two
 * bullet sections, an empty one is not a verdict — an essay that links nothing worth reading has
 * said nothing — so it draws nothing, not a heading over an empty line. A summary written before
 * the list existed has no key, and a malformed list hides only this section, never the rest.
 * Whether it is a checklist depends on Instapaper, not the wiki: with no credentials it is a
 * plain list of links.
 */

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
  /** Whether this deployment can send to Instapaper — what makes Further reading a checklist. */
  instapaperConfigured: boolean;
}

/** A bulleted section as the plain list: its real bullets, or its honest empty line. */
function PlainSection({
  heading,
  bullets,
  empty,
}: {
  heading: string;
  bullets: readonly string[];
  empty: string;
}) {
  return (
    <section>
      <h3 className={SECTION_HEADING_CLASS}>{heading}</h3>
      {bullets.length > 0 ? (
        <ul className={plainBulletListClass}>
          {bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
        </ul>
      ) : (
        <p className={PARAGRAPH_CLASS}>{empty}</p>
      )}
    </section>
  );
}

export function PostOverview({
  overview,
  post,
  writable,
  instapaperConfigured,
}: PostOverviewProperties) {
  const ideas = overview.novel_ideas.filter((idea) => isBullet(idea));
  const evidence = overview.evidence.filter((item) => isBullet(item));
  const furtherReading = furtherReadingOf(overview.further_reading);
  const checklist = writable && (ideas.length > 0 || evidence.length > 0);
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-3">
      {checklist ? (
        <WikiPicks
          postId={post.id}
          ideas={{
            heading: 'Novel ideas',
            bullets: ideas,
            sent: post.wiki_sent_ideas,
            empty: <p className={PARAGRAPH_CLASS}>{EMPTY_NOVEL_IDEAS_LINE}</p>,
          }}
          evidence={{
            heading: 'Evidence',
            bullets: evidence,
            sent: post.wiki_sent_evidence,
            empty: <p className={PARAGRAPH_CLASS}>{EMPTY_EVIDENCE_LINE}</p>,
          }}
        />
      ) : (
        <>
          <PlainSection heading="Novel ideas" bullets={ideas} empty={EMPTY_NOVEL_IDEAS_LINE} />
          <PlainSection heading="Evidence" bullets={evidence} empty={EMPTY_EVIDENCE_LINE} />
        </>
      )}

      <section>
        <h3 className={SECTION_HEADING_CLASS}>The argument</h3>
        <p className={PARAGRAPH_CLASS}>{overview.argument}</p>
      </section>

      <section>
        <h3 className={SECTION_HEADING_CLASS}>Who should read it</h3>
        <p className={PARAGRAPH_CLASS}>{overview.who_should_read}</p>
      </section>

      {furtherReading.length > 0 && (
        <FurtherReading
          postId={post.id}
          items={furtherReading}
          sentReader={post.further_sent_reader}
          sentInstapaper={post.further_sent_instapaper}
          instapaperConfigured={instapaperConfigured}
        />
      )}
    </div>
  );
}
