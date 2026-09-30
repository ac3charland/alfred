'use client';

import { ArrowUpRight, BookOpen, Check } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Button } from '@/components/atoms/button';
import { Spinner } from '@/components/atoms/spinner';
import { MODULE_ACCENT } from '@/lib/modules';
import { useFurtherReadingSendInFlight, useReaderActions } from '@/lib/stores/reader-store';
import type { FurtherReadingDestination, ReaderFurtherReading } from '@/lib/types';
import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';
import { cn } from '@/lib/utils';

import {
  barClass,
  clearClass,
  counterClass,
  headingRowClass,
  ignoreEnter,
  listClass,
  plainBulletListClass,
  rowClass,
  statusClass,
  tickBoxClass,
  tickRowClass,
  tickSlotClass,
} from './reader-checklist.styles';

/**
 * The links a post leans on that are worth reading in full — the model's picks from the post's
 * own anchors — as a checklist the owner sends on: into the Reader, to be summarised like any
 * article, or to Instapaper's Unread pile to read there. It is the overview's last section, apart
 * from the wiki picks on purpose: two selection bars in a row with different verbs invite sending
 * a link to the wiki, or a bullet to Instapaper. Selection here is its own, and ticking a link
 * never ticks a bullet.
 *
 * It borrows the wiki picks' look and gestures (the shared checklist chrome, Select all on the
 * heading row, a bar that folds in at the first tick) but not their rows: each item is two lines,
 * a title over the note that says why the post links it, and it carries its own open link (↗) so
 * the piece can be read before it is sent. That link sits BESIDE the checkbox button, never inside
 * it — a link nested in a button is invalid markup and its click would toggle the row.
 *
 * An item sent anywhere is out of the selection for good, the way a wiki-sent bullet is: its tick
 * becomes a check and a status says where it went ("In Reader" in the module's green, "In
 * Instapaper" muted; a link in both shows the Reader). Sending it a second time would leave one
 * link bookmarked twice, and Instapaper's own folders are the way to move it later. A send that
 * saved only some links keeps the rest ticked, so the retry is one press; one that saved nothing
 * keeps every tick. The store toasts both; the write itself lives in its action, so a send whose
 * row is collapsed mid-flight still lands, and whether one is in the air comes from the store
 * because the section remounts each time the overview opens.
 *
 * A deployment with no Instapaper credentials cannot send, so it gets a plain bulleted list of
 * links — the title is the link, the note follows — with no tick, no bar and no store read. That
 * holds whether or not the wiki is connected: the two are unrelated.
 */

export interface FurtherReadingProperties {
  postId: string;
  /** The overview's picks, in the order the post links them. Every URL is a web URL. */
  items: readonly ReaderFurtherReading[];
  /** The exact URL of every item already sent into the Reader. */
  sentReader: readonly string[];
  /** The exact URL of every item already sent to Instapaper's Unread. */
  sentInstapaper: readonly string[];
  /** Whether this deployment can send to Instapaper at all. */
  instapaperConfigured: boolean;
}

const HEADING = 'Further reading';
const linkClass =
  'rounded-sm font-medium text-foreground underline underline-offset-2 hover:no-underline ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Where a link opens: a new tab, with no way back to the app from the page it lands on. */
const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** The open link beside a row: a ghost icon link, named for the piece it opens. */
function OpenLink({ item }: { item: ReaderFurtherReading }) {
  return (
    <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground">
      <a href={item.url} aria-label={`Open ${item.title}`} {...NEW_TAB}>
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </Button>
  );
}

/** The item's two lines: its title over the note that says what the post uses it for. */
function ItemText({
  item,
  titleId,
  noteId,
}: {
  item: ReaderFurtherReading;
  titleId: string;
  noteId: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span id={titleId} className="block font-medium">
        {item.title}
      </span>
      {item.note !== '' && (
        <span id={noteId} className="block text-muted-foreground">
          {item.note}
        </span>
      )}
    </span>
  );
}

/** Each unsent URL once, in list order: a link the post repeats is one pick. */
function uniqueUnsent(
  items: readonly ReaderFurtherReading[],
  isSent: (url: string) => boolean,
): string[] {
  return [...new Set(items.map((item) => item.url))].filter((url) => !isSent(url));
}

function FurtherReadingChecklist({
  postId,
  items,
  sentReader,
  sentInstapaper,
}: Omit<FurtherReadingProperties, 'instapaperConfigured'>) {
  const { sendFurtherReading } = useReaderActions();
  const inFlight = useFurtherReadingSendInFlight(postId);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  /** The destination of the send in the air from this mount, so its button can say Sending…. */
  const [sending, setSending] = React.useState<FurtherReadingDestination | undefined>();
  const idPrefix = React.useId();
  const rootRef = React.useRef<HTMLElement>(null);
  /** Set by a landed send: the bar may have folded away, taking focus with it. */
  const refocusRef = React.useRef(false);

  const reader = new Set(sentReader);
  const instapaper = new Set(sentInstapaper);
  const isSent = (url: string) => reader.has(url) || instapaper.has(url);
  const unsent = uniqueUnsent(items, isSent);
  // Only what can still be sent counts as ticked — a link another tab sent meanwhile drops out.
  const ticked = unsent.filter((url) => selected.has(url));
  const count = ticked.length;
  const busy = sending !== undefined || inFlight;

  // The bar keeps its last count while it folds away, rather than reading "0 selected" for the
  // length of the collapse.
  const [shownCount, setShownCount] = React.useState(count);
  if (count > 0 && count !== shownCount) setShownCount(count);

  // After a send lands, focus follows it rather than dropping to the page: the pressed button may
  // have folded away with the bar. The first link still to tick takes it, or the heading row once
  // there is none. Runs after every render, and only acts on the one that follows a landed send.
  React.useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    // Only focus that was really lost moves: dropped to the page, or left inside the folded bar.
    // Focus the owner took elsewhere mid-send stays exactly where it is.
    const active = document.activeElement;
    const lost =
      active === null ||
      active === document.body ||
      (rootRef.current?.contains(active) === true && active.closest('[inert]') !== null);
    if (!lost) return;
    const next = rootRef.current?.querySelector<HTMLElement>('[role="checkbox"]');
    (next ?? rootRef.current?.querySelector<HTMLElement>('[data-heading-row]'))?.focus();
  });

  const toggle = (url: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const allTicked = count === unsent.length;

  const send = async (destination: FurtherReadingDestination) => {
    if (busy || count === 0) return;
    setSending(destination);
    try {
      const result = await sendFurtherReading(postId, destination, ticked);
      // What the server did not save stays ticked, so the retry is one press; everything it did
      // save is out of the selection.
      setSelected(new Set(result.unsent));
      refocusRef.current = true;
    } catch {
      // The store has toasted; the ticks stay exactly as they were, so the retry is one press.
    } finally {
      setSending(undefined);
    }
  };

  // The spinner is decoration beside the word: hidden, so the button's name is just "Sending…".
  const pending = (
    <>
      <span aria-hidden="true" className="inline-flex">
        <Spinner size={14} label="Sending" />
      </span>
      Sending…
    </>
  );

  return (
    <section ref={rootRef}>
      <div
        className={headingRowClass}
        data-testid="further-reading-heading-row"
        data-heading-row=""
        tabIndex={-1}
      >
        <h3 className={SECTION_HEADING_CLASS}>{HEADING}</h3>
        {unsent.length === 0 ? (
          <span className={statusClass}>
            <Check
              size={12}
              aria-hidden="true"
              className={MODULE_ACCENT.reader.text}
              data-testid="further-reading-all-sent-check"
            />
            All sent
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`${allTicked ? 'Deselect all' : 'Select all'} ${HEADING}`}
            onClick={() => {
              setSelected(allTicked ? new Set() : new Set(unsent));
            }}
          >
            {allTicked ? 'Deselect all' : 'Select all'}
          </Button>
        )}
      </div>

      <ul className={listClass}>
        {items.map((item, index) => {
          const rowKey = `${String(index)}:${item.url}`;
          const titleId = `${idPrefix}-title-${String(index)}`;
          const noteId = `${idPrefix}-note-${String(index)}`;
          // A URL the list repeats is one pick: only its first row is drawn.
          if (items.findIndex((other) => other.url === item.url) !== index) return;
          if (isSent(item.url)) {
            const inReader = reader.has(item.url);
            return (
              <li key={rowKey} className={rowClass}>
                <span aria-hidden="true" className={tickSlotClass}>
                  <Check
                    size={14}
                    className={MODULE_ACCENT.reader.text}
                    data-testid="further-reading-sent-mark"
                  />
                </span>
                <ItemText item={item} titleId={titleId} noteId={noteId} />
                <span className={cn(statusClass, 'mt-1', inReader && MODULE_ACCENT.reader.text)}>
                  {inReader ? 'In Reader' : 'In Instapaper'}
                </span>
                <OpenLink item={item} />
              </li>
            );
          }
          const isTicked = selected.has(item.url);
          return (
            <li key={rowKey} className="flex items-start gap-1">
              <Button
                variant="ghost"
                role="checkbox"
                aria-checked={isTicked}
                aria-labelledby={titleId}
                aria-describedby={item.note === '' ? undefined : noteId}
                disabled={busy}
                className={cn(tickRowClass, 'w-auto min-w-0 flex-1')}
                onKeyDown={ignoreEnter}
                onClick={() => {
                  toggle(item.url);
                }}
              >
                <span
                  aria-hidden="true"
                  data-testid="further-reading-tick"
                  className={tickBoxClass(isTicked, busy)}
                >
                  {isTicked && (
                    <Check
                      size={10}
                      className="text-background"
                      strokeWidth={3}
                      data-testid="further-reading-tick-check"
                    />
                  )}
                </span>
                <ItemText item={item} titleId={titleId} noteId={noteId} />
              </Button>
              <OpenLink item={item} />
            </li>
          );
        })}
      </ul>

      <AnimatedHeightCollapse open={count > 0} testId="further-reading-selection">
        <div role="group" aria-label="Selected links" className={barClass}>
          <span className={counterClass}>{shownCount} selected</span>
          <Button
            variant="accent"
            size="sm"
            disabled={busy}
            onClick={() => {
              void send('reader');
            }}
          >
            {sending === 'reader' ? (
              pending
            ) : (
              <>
                <BookOpen size={14} aria-hidden="true" />
                Send to Reader
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              void send('instapaper');
            }}
          >
            {sending === 'instapaper' ? pending : 'Send to Instapaper'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={clearClass}
            disabled={busy}
            onClick={() => {
              setSelected(new Set());
            }}
          >
            Clear
          </Button>
        </div>
      </AnimatedHeightCollapse>
    </section>
  );
}

/** No Instapaper to send to: the links, plainly — each title is the link, the note follows. */
function FurtherReadingLinks({ items }: { items: readonly ReaderFurtherReading[] }) {
  return (
    <section>
      <h3 className={SECTION_HEADING_CLASS}>{HEADING}</h3>
      <ul className={plainBulletListClass}>
        {items.map((item, index) => (
          <li key={`${String(index)}:${item.url}`}>
            <a href={item.url} className={linkClass} {...NEW_TAB}>
              {item.title}
            </a>
            {item.note !== '' && ` — ${item.note}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FurtherReading({ instapaperConfigured, ...properties }: FurtherReadingProperties) {
  return instapaperConfigured ? (
    <FurtherReadingChecklist {...properties} />
  ) : (
    <FurtherReadingLinks items={properties.items} />
  );
}
