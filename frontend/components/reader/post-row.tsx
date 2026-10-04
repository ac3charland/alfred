'use client';

import { ArrowUpRight, RotateCw } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Button } from '@/components/atoms/button';
import { ClickableCard } from '@/components/atoms/clickable-card';
import { formatPostDate, formatReadMinutes } from '@/components/reader/reader-format';
import { useAnimatedRowExit } from '@/lib/hooks/use-animated-row-exit';
import { readerHotkeyAction } from '@/lib/reader/hotkeys';
import { postOpenLink } from '@/lib/reader/open-link';
import { isReaderOverview } from '@/lib/reader/overview';
import { sendUnavailable } from '@/lib/reader/send';
import { useInstapaperConfigured, useReaderActions } from '@/lib/stores/reader-store';
import type { ReaderPostListItem, ReaderSummaryState } from '@/lib/types';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

import { PostMarkers } from './post-markers';
import { PostOverview } from './post-overview';
import {
  eyebrowClass,
  gistClass,
  hintClass,
  metaClass,
  originalLinkClass,
  overviewFooterClass,
  overviewFooterVerbsClass,
  placeholderGistClass,
  rowCollapseClass,
  rowCollapseInnerClass,
  rowFadeClass,
  rowShellClass,
  summaryStampClass,
  supersededGistClass,
  titleClass,
  verbRowClass,
} from './post-row.styles';

/**
 * One row of the reading list: publication, arrival, title, gist — and once opened, the
 * overview.
 *
 * Its primary verb sends the post to Instapaper, where the owner reads; the original stays one
 * quiet link away. The row owns its own exit animation (archiving or sending collapses before
 * the mutation commits, so the list doesn't jump), its own overview toggle (local `useState`;
 * no cross-row coordination store — more than one row may sit expanded at once, unlike a
 * single-selection queue) and,
 * while it is the selected row, the verb hotkeys. Selection itself belongs to the list, since
 * only one row may hold it and navigation has to work with nothing selected at all.
 */

/**
 * Which list the row is in. The archive's rows are the reading list's rows with one verb
 * reversed — same markers, same overview, same exit — so the two are one component with a
 * variant rather than two that drift apart.
 */
export type PostRowVariant = 'list' | 'archive';

export interface PostRowProperties {
  post: ReaderPostListItem;
  now: Date;
  /** Which list this row is in; the archive reverses the archive verb. Defaults to the list. */
  variant?: PostRowVariant;
  /** Whether the keyboard is pointing at this row. */
  selected?: boolean;
  /** Point the keyboard at this row, or clear the selection entirely. */
  onSelect?: (id: string | null) => void;
  /**
   * The row has begun leaving (archived or sent from the list, or unarchived from the archive).
   * Fired as the exit STARTS, not when it commits, so the list can move the selection on while
   * the collapse plays rather than leaving it on a row that is halfway gone.
   */
  onExit?: (id: string) => void;
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
 * Whether a re-run could do anything. The summariser works from the STORED text, so a post whose
 * body the retention sweep took, or that never had one to begin with, can only fail again — and
 * a verb that is guaranteed to fail is worse than no verb. The route refuses both cases too, for
 * the tab that was left open before the sweep ran.
 */
function canResummarize(post: ReaderPostListItem): boolean {
  return post.text_swept_at === null && post.word_count > 0;
}

/**
 * How a floor state's line ends. Normally with what the owner can still do; for a post whose
 * text has been swept, with why the retry verb they might look for is not there.
 */
function floorStateTail(post: ReaderPostListItem, now: Date): string {
  return post.text_swept_at === null
    ? 'The post is still here; send it or archive it.'
    : `Its text was swept on ${formatPostDate(post.text_swept_at, now)}, so it can't be retried; ` +
        'send it or archive it.';
}

/**
 * The generic clause a floor state falls back to when the tick recorded no `last_error` —
 * `refused` when the API gave no `stop_details.explanation` for the category, `failed` for every
 * other content-shaped miss.
 */
const GENERIC_CLAUSE: Record<'refused' | 'failed', string> = {
  refused: 'the model declined to summarise this one',
  failed: "the model couldn't produce one",
};

/**
 * The floor states' placeholder line, in the gist's place, and a `done` post's own gist. Both
 * `refused`'s and `failed`'s middle clause are drawn from `last_error` when the tick recorded
 * one — the model's own refusal explanation, or the content-shaped failure reason — so the row
 * says exactly what happened rather than a generic apology. A `pending` post that already has a
 * gist is being RE-summarised, and keeps the summary it has until the tick replaces it.
 */
function gistOrPlaceholder(post: ReaderPostListItem, state: ReaderSummaryState, now: Date): string {
  switch (state) {
    case 'pending': {
      return (
        post.gist ?? 'The summary is on its way — send it now, or check back in a few minutes.'
      );
    }
    case 'refused':
    case 'failed': {
      const reason = post.last_error?.trim();
      const clause = reason === undefined || reason === '' ? GENERIC_CLAUSE[state] : reason;
      return `No summary — ${clause}. ${floorStateTail(post, now)}`;
    }
    case 'done': {
      return post.gist ?? '';
    }
  }
}

/** Which treatment the line in the gist's place takes. */
function gistLineClass(post: ReaderPostListItem, state: ReaderSummaryState): string {
  if (state === 'done') return gistClass;
  if (state === 'pending' && post.gist !== null) return supersededGistClass;
  return placeholderGistClass;
}

/**
 * Where the summary came from: the model, the prompt version it was written under, and when.
 * Stored since the first tick and drawn here because a re-summarised row has to visibly change
 * version — otherwise "I re-ran it" and "nothing happened" look the same.
 */
function summaryStamp(post: ReaderPostListItem, now: Date): string | null {
  const parts: string[] = [];
  if (post.model !== null) parts.push(post.model);
  if (post.prompt_version !== null) parts.push(`prompt v${String(post.prompt_version)}`);
  if (post.summarized_at !== null) parts.push(formatPostDate(post.summarized_at, now));
  return parts.length === 0 ? null : parts.join(' · ');
}

export function PostRow({
  post,
  now,
  variant = 'list',
  selected = false,
  onSelect,
  onExit,
}: PostRowProperties) {
  const actions = useReaderActions();
  const instapaperConfigured = useInstapaperConfigured();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [overviewOpen, setOverviewOpen] = React.useState(false);
  const shellRef = React.useRef<HTMLDivElement>(null);
  // What the card and the Overview verb say they control, so a screen reader can follow the
  // disclosure to the region it opens rather than being told a state with no referent.
  const panelId = React.useId();

  // The mutation the exit is playing for — the archive verb's, or the send's from the list.
  const commitRef = React.useRef<(() => Promise<unknown>) | null>(null);
  const commit = React.useCallback(async () => {
    await commitRef.current?.();
  }, []);
  const exit = useAnimatedRowExit(commit, prefersReducedMotion);
  const { begin } = exit;

  const archived = variant === 'archive';
  const archiveLabel = archived ? 'Unarchive' : 'Archive';

  // The archive verb, both directions: the same exit collapse, a different write at the end of
  // it. The list is told as the exit STARTS so the selection can move on while it plays.
  const beginArchive = React.useCallback(() => {
    if (exit.isExiting) return;
    commitRef.current = () => (archived ? actions.unarchive(post.id) : actions.archive(post.id));
    onExit?.(post.id);
    begin();
  }, [actions, archived, begin, exit.isExiting, onExit, post.id]);

  const sendBlocked = sendUnavailable(post, instapaperConfigured);

  // From the list, a send leaves exactly as an archive does — the store archives the post with
  // it — so it plays the same collapse and commits at the end of it. From the archive the row
  // stays put: the post was already put away, and the badge appears in place.
  const send = React.useCallback(() => {
    if (sendBlocked !== undefined) return;
    if (archived) {
      void actions.sendToInstapaper(post.id).catch(() => {
        // Deliberately silent here: the store rolls the row back and toasts the reason.
      });
      return;
    }
    if (exit.isExiting) return;
    commitRef.current = () => actions.sendToInstapaper(post.id);
    onExit?.(post.id);
    begin();
  }, [actions, archived, begin, exit.isExiting, onExit, post.id, sendBlocked]);

  const resummarize = React.useCallback(() => {
    void actions.resummarize(post.id).catch(() => {
      // Deliberately silent here: the store rolls the row back and toasts, and the row has
      // nothing further to do — but the rejection still has to be absorbed.
    });
  }, [actions, post.id]);

  const link = postOpenLink(post);
  const href = link.href;

  // Following the post out to its original stamps `opened_at`, whichever way the owner went: the
  // anchor navigates natively and only stamps; the `o` key opens the same target itself, because
  // the anchor may sit inside a collapsed — inert — panel where it cannot be clicked.
  const noteOpened = React.useCallback(() => {
    onSelect?.(post.id);
    actions.markOpened(post.id);
  }, [actions, onSelect, post.id]);
  const openOriginal = React.useCallback(() => {
    if (href === undefined) return;
    globalThis.open(href, '_blank', 'noopener,noreferrer');
    noteOpened();
  }, [href, noteOpened]);

  const state = summaryState(post);
  // A re-summarising row keeps its previous overview too: the panel is about the summary that is
  // being replaced, and pulling it out from under the owner mid-run would be the same blanking
  // the pending gist avoids.
  const keepsSummary = state === 'done' || (state === 'pending' && post.gist !== null);
  const overview = keepsSummary && isReaderOverview(post.overview) ? post.overview : undefined;
  const dimmed = state === 'failed' || state === 'refused';

  const retryable = (state === 'failed' || state === 'refused') && canResummarize(post);
  const stamp = state === 'done' ? summaryStamp(post, now) : null;
  const rerunnable = state === 'done' && canResummarize(post);
  const hasSummaryFooter = stamp !== null || rerunnable;
  const hasOverview = overview !== undefined;
  /**
   * Whether there is anything to disclose at all. The panel holds the overview AND the summary's
   * stamp with its re-run verb, so a done row whose overview failed the guard still has one —
   * and the verb, the `v` key and the card's own disclosure all key off this single question, so
   * none of them can offer to open something that isn't there or hide something that is.
   *
   * The Original link never makes a panel: a row with nothing else to disclose would grow an
   * "Overview" toggle with no overview behind it. It sits in the panel's footer when there is a
   * panel, and at the end of the verb row when there isn't — so every row with somewhere to point
   * has exactly one way out to the original.
   */
  const hasPanel = hasOverview || hasSummaryFooter;
  const panelOpen = hasPanel && overviewOpen;
  const originalInFooter = hasPanel && href !== undefined;
  const originalInVerbs = !hasPanel && href !== undefined;
  const hasFooter = hasSummaryFooter || originalInFooter;

  const toggleOverview = React.useCallback(() => {
    if (!hasPanel) return;
    setOverviewOpen((open) => !open);
  }, [hasPanel]);

  // Bring the selected row into view when the keyboard walks onto it. `nearest` scrolls the
  // least that makes the row visible, so a row already on screen doesn't jump under the owner.
  React.useEffect(() => {
    if (!selected) return;
    const node = shellRef.current;
    // `scrollIntoView` is unimplemented under jsdom, so feature-detect before calling.
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  // The verb hotkeys, live only while this row is the selected one — so exactly one row-level
  // listener is ever attached, however long the list is. Navigation and Escape are the list's,
  // since they have to work when nothing is selected at all.
  React.useEffect(() => {
    if (!selected) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const action = readerHotkeyAction(event);
      switch (action) {
        case 'send': {
          // The button's own handler, so the key and the verb cannot drift apart — and nothing at
          // all while the button is disabled.
          if (sendBlocked !== undefined) break;
          event.preventDefault();
          send();
          break;
        }
        case 'open': {
          // The same target and the same stamp as the Original link. A post with nowhere to point
          // draws no link, and the key does nothing.
          if (href === undefined) break;
          event.preventDefault();
          openOriginal();
          break;
        }
        case 'archive': {
          event.preventDefault();
          beginArchive();
          break;
        }
        case 'overview': {
          if (!hasPanel) break;
          event.preventDefault();
          toggleOverview();
          break;
        }
        default: {
          // `next` / `previous` / `deselect` belong to the list.
          break;
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selected, hasPanel, beginArchive, toggleOverview, send, sendBlocked, href, openOriginal]);

  /** The key that runs a verb, beside its label — on the selected row only, desktop only. */
  const hint = (key: string) =>
    selected ? (
      <kbd aria-hidden="true" className={hintClass}>
        {key}
      </kbd>
    ) : null;

  /**
   * The quiet way out to the post itself, drawn in whichever of its two places applies. Its
   * keycap shows only while the link itself can be seen — never from inside a shut panel, where
   * it would point at a verb the owner cannot see (the key works either way).
   */
  const originalVisible = originalInVerbs || (originalInFooter && panelOpen);
  const original =
    href === undefined ? null : (
      <Button variant="ghost" size="sm" className={originalLinkClass} asChild>
        <a href={href} target="_blank" rel="noreferrer" onClick={noteOpened}>
          <ArrowUpRight size={14} />
          Original
          {originalVisible && hint('o')}
        </a>
      </Button>
    );

  return (
    <div
      data-testid="reader-row-collapse"
      className={cn(rowCollapseClass, exit.isExiting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}
      onTransitionEnd={exit.onCollapseEnd}
    >
      <div className={cn('overflow-hidden', rowCollapseInnerClass)}>
        <div className={cn(rowFadeClass, exit.isExiting && 'opacity-0')}>
          <div
            ref={shellRef}
            className={rowShellClass({ selected, expanded: panelOpen, dimmed })}
            data-testid="reader-row"
            data-selected={String(selected)}
          >
            <ClickableCard
              // Only a card that actually discloses something claims to: on a row with no panel
              // the click still selects, and an `aria-expanded` there would promise a region
              // that never appears.
              aria-expanded={hasPanel ? panelOpen : undefined}
              aria-controls={hasPanel ? panelId : undefined}
              onClick={() => {
                // One gesture, two effects: the click points the keyboard here AND toggles the
                // overview, so a mouse and a keyboard owner never disagree about which row is
                // live. Selection is not cleared by a second click — that is Escape's job.
                onSelect?.(post.id);
                toggleOverview();
              }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={eyebrowClass}>{post.author ?? 'Unknown publication'}</span>
                <span className={metaClass}>
                  {formatPostDate(post.received_at, now)} · {formatReadMinutes(post.word_count)}
                </span>
                <PostMarkers state={state} sent={post.instapaper_sent_at !== null} />
              </div>
              <p className={titleClass}>{post.title}</p>
              <p className={gistLineClass(post, state)}>{gistOrPlaceholder(post, state, now)}</p>
            </ClickableCard>

            <div className={verbRowClass} data-testid="reader-row-verbs">
              <Button
                variant="outline"
                size="sm"
                disabled={sendBlocked !== undefined}
                title={sendBlocked}
                onClick={() => {
                  onSelect?.(post.id);
                  send();
                }}
              >
                Send to Instapaper
                {/* No keycap on a disabled verb: `i` does nothing there. */}
                {sendBlocked === undefined && hint('i')}
              </Button>

              {hasPanel && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={panelOpen}
                  aria-controls={panelId}
                  onClick={() => {
                    // Every verb points the keyboard at its own row first, so the key that acts
                    // on the selected row acts on the one just clicked — `v` on the panel this
                    // click opened, not on whichever row the keyboard was left on.
                    onSelect?.(post.id);
                    toggleOverview();
                  }}
                >
                  {panelOpen ? 'Hide overview' : 'Overview'}
                  {hint('v')}
                </Button>
              )}

              {retryable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    onSelect?.(post.id);
                    resummarize();
                  }}
                >
                  <RotateCw size={14} />
                  Retry summary
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onSelect?.(post.id);
                  beginArchive();
                }}
              >
                {archiveLabel}
                {hint('e')}
              </Button>

              {originalInVerbs && original}
            </div>

            {/* The id the card and the Overview verb point at sits on a plain wrapper rather than
                on the collapse itself, so the shared atom keeps its own small prop surface. */}
            {hasPanel && (
              <div id={panelId}>
                <AnimatedHeightCollapse open={panelOpen} testId="reader-row-overview">
                  {overview !== undefined && <PostOverview overview={overview} />}
                  {hasFooter && (
                    <div className={overviewFooterClass}>
                      <div className={overviewFooterVerbsClass}>
                        {originalInFooter && original}
                        {rerunnable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => {
                              onSelect?.(post.id);
                              resummarize();
                            }}
                          >
                            <RotateCw size={14} />
                            Re-summarise
                          </Button>
                        )}
                      </div>
                      {stamp !== null && <span className={summaryStampClass}>{stamp}</span>}
                    </div>
                  )}
                </AnimatedHeightCollapse>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
