'use client';

import { BookPlus, Check } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Button } from '@/components/atoms/button';
import { Spinner } from '@/components/atoms/spinner';
import { checkboxIncompleteClass, checkboxSizeClass } from '@/components/tasks/task-row.styles';
import { isIdea } from '@/lib/reader/overview';
import { useReaderActions, useWikiSendInFlight } from '@/lib/stores/reader-store';
import { cn } from '@/lib/utils';

/**
 * A post's Novel ideas as a checklist with one dispatch: tick the bullets worth keeping, then
 * send them together, so one article reaches the wiki as one send — one folder, one commit, one
 * kickoff. It is the Inbox's select-then-Dispatch gesture in miniature, reusing its tick box and
 * its bulk bar's counter and accent button, laid inline under the list rather than floating.
 * "Send all to wiki" on the heading row stays as the one-press shortcut.
 *
 * Selection is this list's own state, keyed by bullet text (a bullet has no id, and the sent
 * marks are recorded as text too), so collapsing the overview drops it. Which button was pressed
 * is local too, but whether a send is in the air at all comes from the store: the list remounts
 * each time the overview opens, and a send started before that must still hold every control.
 * The write itself lives in the store action, so a send whose row is collapsed mid-flight still
 * lands. Selection and the primary action wear the app's standard teal; violet is kept for the
 * wiki's own marks — the sent checks and the glyph on Send all.
 */

export interface NovelIdeaListProperties {
  postId: string;
  /** The overview's bullets, in the order the model returned them. */
  ideas: readonly string[];
  /** The exact text of every bullet already sent. */
  sentIdeas: readonly string[];
  /** The section's heading, which shares its row with Send all. */
  heading: React.ReactNode;
}

/** Which of the two sends is in flight, if either. */
type Sending = 'selected' | 'all' | null;

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/**
 * The heading row, only while the wiki controls render: 32px, the Send all button's height, so
 * the heading doesn't jump when the button swaps for "All sent".
 */
const headingRowClass =
  'flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-sm ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const listClass = 'mt-1 flex flex-col gap-0.5';
/** One bullet's row: the tick slot beside the bullet's own `text-sm` text. */
const rowClass = 'flex items-start gap-2.5 rounded-md px-1.5 py-1 text-sm text-foreground';
/**
 * The Button atom's centred, single-line chrome reset into a full-width, wrapping row — the whole
 * row is the hit target, so it works on a phone. A disabled row keeps its text at full strength;
 * only its tick box dims, the atoms' 50%.
 */
const tickRowClass = cn(
  rowClass,
  'h-auto w-full justify-start whitespace-normal text-left font-normal',
  'disabled:opacity-100',
);
const tickSlotClass = cn(checkboxSizeClass, 'mt-0.5 flex shrink-0 items-center justify-center');
const statusClass = 'inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground';
const barClass = cn(
  'mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 px-1.5 pt-1.5',
);

/**
 * The ARIA checkbox pattern toggles on Space only. A `<button>` also clicks on Enter, so the
 * keydown's default is stopped there — Enter on a bullet does nothing.
 */
function ignoreEnter(event: React.KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter') event.preventDefault();
}

export function NovelIdeaList({
  postId,
  ideas: bullets,
  sentIdeas,
  heading,
}: NovelIdeaListProperties) {
  const ideas = React.useMemo(() => bullets.filter((bullet) => isIdea(bullet)), [bullets]);
  const { sendIdeasToWiki } = useReaderActions();
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [sending, setSending] = React.useState<Sending>(null);
  const inFlight = useWikiSendInFlight(postId);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  /** Set by a landed send: its button may be gone or folded away, taking focus with it. */
  const refocusRef = React.useRef(false);

  const sent = React.useMemo(() => new Set(sentIdeas), [sentIdeas]);
  // Each bullet once, in list order: a repeated bullet is one idea, and one pick.
  const unsent = React.useMemo(
    () => [...new Set(ideas)].filter((idea) => !sent.has(idea)),
    [ideas, sent],
  );
  // Only what can still be sent counts as ticked — a bullet another tab sent meanwhile drops out.
  const ticked = unsent.filter((idea) => selected.has(idea));
  const count = ticked.length;
  const busy = sending !== null || inFlight;

  // The bar keeps its last count while it folds away, rather than reading "0 selected" for the
  // length of the collapse.
  const [shownCount, setShownCount] = React.useState(count);
  if (count > 0 && count !== shownCount) setShownCount(count);

  // After a send lands, focus follows it rather than dropping to the page: the pressed button has
  // folded away with the bar, or become "All sent". The next bullet still to tick takes it, or
  // the heading row once there is none. Runs after every render, and only acts on the one that
  // follows a landed send — by then the sent bullets are drawn and the controls re-enabled.
  React.useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    // Only focus that was really lost moves: dropped to the page (the removed Send all), or left
    // inside the folded bar. Focus the owner took elsewhere mid-send stays exactly where it is.
    const active = document.activeElement;
    const lost =
      active === null ||
      active === document.body ||
      (rootRef.current?.contains(active) === true && active.closest('[inert]') !== null);
    if (!lost) return;
    const next = listRef.current?.querySelector<HTMLElement>('[role="checkbox"]');
    (next ?? rootRef.current?.querySelector<HTMLElement>('[data-heading-row]'))?.focus();
  });

  const toggle = (idea: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(idea)) next.delete(idea);
      else next.add(idea);
      return next;
    });
  };

  const send = async (which: 'selected' | 'all') => {
    const batch = which === 'all' ? unsent : ticked;
    if (busy || batch.length === 0) return;
    setSending(which);
    try {
      await sendIdeasToWiki(postId, batch);
      // Not redundant with the sent filter: the server's row is the truth, and a tick on a
      // bullet it did not mark (a re-summarise reworded it, say) must not survive the send.
      setSelected(EMPTY_SELECTION);
      refocusRef.current = true;
    } catch {
      // The store has toasted; the ticks stay exactly as they were, so the retry is one press.
    } finally {
      setSending(null);
    }
  };

  // The spinner is decoration beside the word: hidden, so the button's name is just "Sending…".
  const sendingLabel = (
    <>
      <span aria-hidden="true" className="inline-flex">
        <Spinner size={14} label="Sending" />
      </span>
      Sending…
    </>
  );

  return (
    <div ref={rootRef}>
      <div
        className={headingRowClass}
        data-testid="novel-ideas-heading-row"
        data-heading-row=""
        tabIndex={-1}
      >
        {heading}
        {unsent.length === 0 ? (
          <span className={statusClass}>
            <Check
              size={12}
              aria-hidden="true"
              className="text-accent-violet"
              data-testid="novel-ideas-all-sent-check"
            />
            All sent to wiki
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              void send('all');
            }}
          >
            {sending === 'all' ? (
              sendingLabel
            ) : (
              <>
                <BookPlus
                  size={14}
                  aria-hidden="true"
                  className="text-accent-violet"
                  data-testid="novel-ideas-send-all-glyph"
                />
                Send all to wiki
              </>
            )}
          </Button>
        )}
      </div>

      <ul ref={listRef} className={listClass}>
        {ideas.map((idea, index) => {
          const key = `${String(index)}:${idea}`;
          if (sent.has(idea)) {
            return (
              <li key={key} className={rowClass}>
                <span aria-hidden="true" className={tickSlotClass}>
                  <Check
                    size={14}
                    className="text-accent-violet"
                    data-testid="novel-idea-sent-mark"
                  />
                </span>
                <span className="min-w-0 flex-1">{idea}</span>
                <span className={cn(statusClass, 'mt-px')}>
                  <Check
                    size={12}
                    aria-hidden="true"
                    className="text-accent-violet"
                    data-testid="novel-idea-sent-check"
                  />
                  Sent
                </span>
              </li>
            );
          }
          const isTicked = selected.has(idea);
          return (
            <li key={key}>
              <Button
                variant="ghost"
                role="checkbox"
                aria-checked={isTicked}
                disabled={busy}
                className={tickRowClass}
                onKeyDown={ignoreEnter}
                onClick={() => {
                  toggle(idea);
                }}
              >
                <span
                  aria-hidden="true"
                  data-testid="novel-idea-tick"
                  className={cn(
                    checkboxSizeClass,
                    'mt-0.5 flex shrink-0 items-center justify-center rounded border',
                    isTicked ? 'border-accent-teal bg-accent-teal' : checkboxIncompleteClass,
                    busy && 'opacity-50',
                  )}
                >
                  {isTicked && (
                    <Check
                      size={10}
                      className="text-background"
                      strokeWidth={3}
                      data-testid="novel-idea-tick-check"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">{idea}</span>
              </Button>
            </li>
          );
        })}
      </ul>

      <AnimatedHeightCollapse open={count > 0} testId="novel-ideas-selection">
        <div role="group" aria-label="Selected ideas" className={barClass}>
          <span className="text-sm font-semibold text-accent-teal">{shownCount} selected</span>
          <Button
            variant="accent"
            size="sm"
            disabled={busy}
            onClick={() => {
              void send('selected');
            }}
          >
            {sending === 'selected' ? (
              sendingLabel
            ) : (
              <>
                <BookPlus size={14} aria-hidden="true" />
                Send to wiki
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setSelected(EMPTY_SELECTION);
            }}
          >
            Clear
          </Button>
        </div>
      </AnimatedHeightCollapse>
    </div>
  );
}
