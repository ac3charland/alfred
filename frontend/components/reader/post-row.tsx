'use client';

import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Button } from '@/components/atoms/button';
import { ClickableCard } from '@/components/atoms/clickable-card';
import { formatPostDate, formatReadMinutes } from '@/components/reader/reader-format';
import { useAnimatedRowExit } from '@/lib/hooks/use-animated-row-exit';
import { postOpenLink } from '@/lib/reader/open-link';
import { isReaderOverview } from '@/lib/reader/overview';
import { useReaderActions } from '@/lib/stores/reader-store';
import type { ReaderPostListItem, ReaderSummaryState } from '@/lib/types';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

import { PostMarkers } from './post-markers';
import { PostOverview } from './post-overview';
import {
  eyebrowClass,
  gistClass,
  metaClass,
  placeholderGistClass,
  rowCollapseClass,
  rowCollapseInnerClass,
  rowFadeClass,
  rowShellClass,
  titleClass,
  verbRowClass,
} from './post-row.styles';

/**
 * One row of the reading list: publication, arrival, title, gist — and once opened, the
 * overview.
 *
 * The row owns its own exit animation (archiving collapses before the mutation commits, so the
 * list doesn't jump) and its own overview toggle (local `useState`; no cross-row coordination
 * store — more than one row may sit expanded at once, unlike a single-selection queue).
 */

export interface PostRowProperties {
  post: ReaderPostListItem;
  now: Date;
}

/**
 * The generated row type carries `summary_state` as a bare `string` — a Postgres CHECK
 * constraint has no type-level shape for the generator to read (see `ReaderSummaryState`'s own
 * doc comment in `lib/types.ts`) — so the row narrows it once, here, rather than threading a
 * `string` through every state-shaped branch below. The CHECK constraint is what makes this
 * narrowing safe: the database will not store anything else.
 */
function summaryState(post: ReaderPostListItem): ReaderSummaryState {
  return post.summary_state as ReaderSummaryState;
}

/**
 * The floor states' placeholder line, in the gist's place, and a `done` post's own gist.
 * `failed`'s middle clause is drawn from `last_error` when the tick recorded one, so the row
 * says exactly what went wrong rather than a generic apology.
 */
function gistOrPlaceholder(post: ReaderPostListItem, state: ReaderSummaryState): string {
  switch (state) {
    case 'pending': {
      return 'The summary is on its way — open it now, or check back in a few minutes.';
    }
    case 'refused': {
      return 'No summary — the model declined to summarise this one. The post is still here; open it or archive it.';
    }
    case 'failed': {
      const reason = post.last_error?.trim();
      const clause =
        reason === undefined || reason === '' ? "the model couldn't produce one" : reason;
      return `No summary — ${clause}. The post is still here; open it or archive it.`;
    }
    case 'done': {
      return post.gist ?? '';
    }
  }
}

export function PostRow({ post, now }: PostRowProperties) {
  const actions = useReaderActions();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [overviewOpen, setOverviewOpen] = React.useState(false);

  // The mutation the exit is playing for — archive is the row's only exit-animated verb.
  const commitRef = React.useRef<(() => Promise<unknown>) | null>(null);
  const commit = React.useCallback(async () => {
    await commitRef.current?.();
  }, []);
  const exit = useAnimatedRowExit(commit, prefersReducedMotion);
  const { begin } = exit;

  const beginArchive = React.useCallback(() => {
    if (exit.isExiting) return;
    commitRef.current = () => actions.archive(post.id);
    begin();
  }, [actions, begin, exit.isExiting, post.id]);

  const link = postOpenLink(post);
  const state = summaryState(post);
  const overview = state === 'done' && isReaderOverview(post.overview) ? post.overview : undefined;
  const dimmed = state === 'failed' || state === 'refused';

  return (
    <div
      data-testid="reader-row-collapse"
      className={cn(rowCollapseClass, exit.isExiting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}
      onTransitionEnd={exit.onCollapseEnd}
    >
      <div className={cn('overflow-hidden', rowCollapseInnerClass)}>
        <div className={cn(rowFadeClass, exit.isExiting && 'opacity-0')}>
          <div className={rowShellClass(overviewOpen, dimmed)} data-testid="reader-row">
            <ClickableCard
              aria-expanded={overviewOpen}
              onClick={() => {
                setOverviewOpen((open) => !open);
              }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={eyebrowClass}>{post.author ?? 'Unknown publication'}</span>
                <span className={metaClass}>
                  {formatPostDate(post.received_at, now)} · {formatReadMinutes(post.word_count)}
                </span>
                <PostMarkers state={state} />
              </div>
              <p className={titleClass}>{post.title}</p>
              <p className={state === 'done' ? gistClass : placeholderGistClass}>
                {gistOrPlaceholder(post, state)}
              </p>
            </ClickableCard>

            <div className={verbRowClass}>
              {link.href === undefined ? (
                <Button variant="outline" size="sm" type="button" disabled title={link.unavailable}>
                  Open
                </Button>
              ) : (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      actions.markOpened(post.id);
                    }}
                  >
                    Open
                  </a>
                </Button>
              )}

              {overview !== undefined && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={overviewOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOverviewOpen((open) => !open);
                  }}
                >
                  {overviewOpen ? 'Hide overview' : 'Overview'}
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  beginArchive();
                }}
              >
                Archive
              </Button>
            </div>

            {overview !== undefined && (
              <AnimatedHeightCollapse open={overviewOpen} testId="reader-row-overview">
                <PostOverview overview={overview} />
              </AnimatedHeightCollapse>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
