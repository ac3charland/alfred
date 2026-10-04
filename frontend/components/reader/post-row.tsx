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
import { useInstapaperConfigured, useReaderActions } from '@/lib/stores/reader-store';
import type { ReaderPostListItem, ReaderSummaryState } from '@/lib/types';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

import { PostMarkers } from './post-markers';
import { PostOverview } from './post-overview';
import {
  eyebrowClass,
  footerVerbsClass,
  gistClass,
  hintClass,
  metaClass,
  overviewFooterClass,
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
 * Its primary verb is SEND TO INSTAPAPER, not "open the original": the owner doesn't read
 * sources where they live, they collect them in Instapaper and read there. One press saves the
 * post and archives it, because once it is in Instapaper that is where it lives. The original
 * stays reachable through a quiet `Original ↗` link, which has two placements (see
 * `hasPanel` below) so every row with a link has exactly one way out.
 *
 * The row owns its own exit animation (archiving collapses before the mutation commits, so the
 * list doesn't jump), its own overview toggle (local `useState`; no cross-row coordination
 * store — more than one row may sit expanded at once, unlike a single-selection queue) and,
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
   * The row has begun leaving (archived, or unarchived from the archive). Fired as the exit
   * STARTS, not when it commits, so the list can move the selection on while the collapse plays
   * rather than leaving it on a row that is halfway gone.
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

  // The mutation the exit is playing for — archive is the row's only exit-animated verb.
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

  const resummarize = React.useCallback(() => {
    void actions.resummarize(post.id).catch(() => {
      // Deliberately silent here: the store rolls the row back and toasts, and the row has
      // nothing further to do — but the rejection still has to be absorbed.
    });
  }, [actions, post.id]);

  const link = postOpenLink(post);

  /**
   * Opening the original, from either route into it. The key cannot simply click the anchor the
   * way the old "Open" verb's did: once the link moved into the overview panel, a collapsed
   * panel is inert (`AnimatedHeightCollapse` hides it from the a11y tree and from pointer
   * events), so there may be no clickable anchor to reach. So the key opens the window itself,
   * the anchor keeps its own native navigation, and both go through here for the stamp — which
   * is what keeps the two from drifting apart.
   */
  const openOriginal = React.useCallback(
    (viaKey: boolean) => {
      if (link.href === undefined) return;
      onSelect?.(post.id);
      actions.markOpened(post.id);
      if (viaKey) globalThis.open(link.href, '_blank', 'noopener,noreferrer');
    },
    [actions, link.href, onSelect, post.id],
  );

  /**
   * Why the send verb cannot work, or `undefined` when it can — the `title` the disabled button
   * carries, so a press that would fail says so before it is pressed.
   *
   * The deployment comes first: a Reader on an instance with no Instapaper credentials says so
   * about every row, and the post's own state is beside the point there.
   */
  const sendUnavailable = (() => {
    if (!instapaperConfigured) return "Instapaper isn't set up on this deployment.";
    // No address AND no body: Instapaper would have no article and nowhere to find one. The
    // route refuses the same two cases, for the tab that was left open before the sweep ran.
    const sendableBody = post.text_swept_at === null && post.word_count > 0;
    if (link.kind !== 'canonical' && !sendableBody) return 'No link and no stored text to send.';
    return;
  })();

  /**
   * The send verb. On the reading list it begins the same exit collapse Archive plays, with the
   * send as the mutation at the end of it — because a successful send archives the post, so the
   * row is leaving either way. In the archive there is nowhere to go: the row stays and its
   * badge appears optimistically.
   *
   * It re-checks `sendUnavailable` rather than trusting its caller: the `i` key reaches it with
   * no disabled attribute in the way, and a key that quietly did nothing is better than one that
   * starts an exit the row cannot finish.
   */
  const beginSend = React.useCallback(() => {
    if (sendUnavailable !== undefined) return;
    if (archived) {
      void actions.sendToInstapaper(post.id).catch(() => {
        // The store rolls the row back and toasts the route's own sentence; nothing is left for
        // the row to do, but the rejection still has to be absorbed.
      });
      return;
    }
    if (exit.isExiting) return;
    commitRef.current = () => actions.sendToInstapaper(post.id);
    onExit?.(post.id);
    begin();
  }, [actions, archived, begin, exit.isExiting, onExit, post.id, sendUnavailable]);
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
  const hasFooter = stamp !== null || rerunnable;
  const hasOverview = overview !== undefined;
  /**
   * Whether there is anything to disclose at all. The panel holds the overview AND the summary's
   * stamp with its re-run verb, so a done row whose overview failed the guard still has one —
   * and the verb, the `v` key and the card's own disclosure all key off this single question, so
   * none of them can offer to open something that isn't there or hide something that is.
   */
  const hasPanel = hasOverview || hasFooter;
  const panelOpen = hasPanel && overviewOpen;

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
          // Nothing when the verb is disabled: `beginSend` holds that rule, so the button and
          // the key cannot disagree about whether this post can be sent.
          event.preventDefault();
          beginSend();
          break;
        }
        case 'open': {
          // Opened through the shared handler rather than by clicking the anchor: on a done row
          // the anchor lives inside the overview panel, which is inert while collapsed, so there
          // may be nothing clickable to reach. A post with nowhere to point does nothing.
          event.preventDefault();
          openOriginal(true);
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
  }, [selected, hasPanel, beginArchive, beginSend, openOriginal, toggleOverview]);

  /** The key that runs a verb, beside its label — on the selected row only, desktop only. */
  const hint = (key: string) =>
    selected ? (
      <kbd aria-hidden="true" className={hintClass}>
        {key}
      </kbd>
    ) : null;

  /**
   * The quiet way back to the source — what the outline "Open" button used to be. Ghost and
   * muted, because it is not what the row is for any more: the post is read in Instapaper, and
   * this is for checking the original.
   *
   * `null` when there is nowhere to point, which is the whole of the old disabled-button state:
   * a row with no link has no way out, and the send verb is what it offers instead.
   */
  const originalLink =
    link.href === undefined ? null : (
      <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer"
          // The anchor navigates natively; this only selects the row and stamps `opened_at`.
          onClick={() => {
            openOriginal(false);
          }}
        >
          <ArrowUpRight size={14} />
          Original
          {hint('o')}
        </a>
      </Button>
    );

  /**
   * Whether the panel's footer strip renders. `hasPanel` deliberately does NOT include the
   * Original link — a link cannot be reason enough to put an "Overview" toggle on a row with no
   * overview — but once a panel exists for another reason, the link belongs in its footer. So
   * the strip appears for a stamp, a re-run verb, or the link.
   */
  const showFooter = hasFooter || originalLink !== null;

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

            <div className={verbRowClass}>
              {sendUnavailable === undefined ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onSelect?.(post.id);
                    beginSend();
                  }}
                >
                  Send to Instapaper
                  {hint('i')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" type="button" disabled title={sendUnavailable}>
                  {/* No keycap: `i` runs the same handler, which refuses for the same reason. */}
                  Send to Instapaper
                </Button>
              )}

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

              {/* A row with no panel has nowhere else to put the way out. Adding a panel just to
                  hold it would put an "Overview" toggle on a row that has no overview. */}
              {!hasPanel && originalLink}
            </div>

            {/* The id the card and the Overview verb point at sits on a plain wrapper rather than
                on the collapse itself, so the shared atom keeps its own small prop surface. */}
            {hasPanel && (
              <div id={panelId}>
                <AnimatedHeightCollapse open={panelOpen} testId="reader-row-overview">
                  {overview !== undefined && <PostOverview overview={overview} />}
                  {showFooter && (
                    <div className={overviewFooterClass}>
                      {/* The two quiet verbs group left, the stamp stays right. */}
                      <div className={footerVerbsClass}>
                        {originalLink}
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
