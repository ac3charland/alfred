'use client';

import { BookOpen, Check, ExternalLink } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Button, buttonVariants } from '@/components/atoms/button';
import { Spinner } from '@/components/atoms/spinner';
import { checkboxIncompleteClass, checkboxSizeClass } from '@/components/tasks/task-row.styles';
import { MODULE_ACCENT } from '@/lib/modules';
import {
  type FurtherReadingDestination,
  useFurtherReadingSendInFlight,
  useInstapaperConfigured,
  useReaderActions,
} from '@/lib/stores/reader-store';
import type { ReaderFurtherReading } from '@/lib/types';
import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';
import { cn } from '@/lib/utils';

import {
  barClass,
  clearClass,
  counterClass,
  headingRowClass,
  ignoreEnter,
  listClass,
  rowClass,
  statusClass,
  tickRowClass,
  tickSlotClass,
} from './wiki-picks';

/**
 * A post's Further reading — the articles it links that are worth reading in full — drawn last in
 * its overview. Where this deployment can send to Instapaper it is a checklist: tick the links
 * worth keeping, then send them to the Reader (Instapaper's "To Reader" folder) or to its Unread
 * list in one press, the same select-then-send gesture as {@link WikiPicks} and drawn with its
 * tick box, counter and bar. Everywhere else it is a plain list of links, because there is
 * nothing to send them to; whether the wiki is writable has no say in either.
 *
 * Each link in the checklist is TWO siblings, never one inside the other: the tick row, which
 * toggles the selection, and a small icon link that opens the article in a new tab. A link nested
 * in the tick row would be an interactive control inside a checkbox, and a tap meant for one would
 * land on the other.
 *
 * A sent link keeps its row and loses its tick: it shows a check and where it went — "In Reader"
 * in the Reader's green, else "In Instapaper" — and still opens. A link in both lists reads
 * "In Reader", the further along of the two. Selection is this component's own state, keyed by
 * URL (the sent marks are recorded as URLs, and two items with one URL are one link), so
 * collapsing the overview drops it; whether a send is in the air comes from the store, which
 * owns the write so one that outlives its collapsed row still lands. A send that part-landed
 * leaves exactly the URLs that did not go ticked, so the retry is one press. While a send is in
 * the air every control is disabled — the ticks, Select all, both sends and Clear — but the open
 * links stay live: opening an article changes nothing here, and a link cannot be disabled anyway.
 */

export interface FurtherReadingProperties {
  postId: string;
  /** The overview's well-formed items, in the order the model returned them. */
  items: readonly ReaderFurtherReading[];
  /** Every URL already sent to the Reader. */
  sentReader: readonly string[];
  /** Every URL already sent to Instapaper's Unread list. */
  sentInstapaper: readonly string[];
}

/** The plain list's classes: the bullet list the overview's other sections use. */
const BULLET_LIST_CLASS = 'mt-1 list-disc space-y-1 pl-5 text-sm text-foreground';
const LINK_CLASS = 'font-medium underline-offset-2 hover:underline';
/** The open-article link: the ghost icon button's chrome, beside the tick row it must not nest in. */
const OPEN_LINK_CLASS = cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-8 w-8 shrink-0');

/** Each item once, the first occurrence winning, as a repeated link is one pick. */
function dedupe(items: readonly ReaderFurtherReading[]): ReaderFurtherReading[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function PlainLinks({ items }: { items: readonly ReaderFurtherReading[] }) {
  return (
    <ul className={BULLET_LIST_CLASS}>
      {dedupe(items).map((item) => (
        <li key={item.url}>
          <a href={item.url} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            {item.title}
          </a>
          {item.note.trim() === '' ? null : (
            <span className="text-muted-foreground"> — {item.note}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function OpenLink({ item }: { item: ReaderFurtherReading }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${item.title}`}
      className={OPEN_LINK_CLASS}
    >
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

function Checklist({ postId, items, sentReader, sentInstapaper }: FurtherReadingProperties) {
  const { sendFurtherReading } = useReaderActions();
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = React.useState<FurtherReadingDestination | null>(null);
  const inFlight = useFurtherReadingSendInFlight(postId);
  const rootRef = React.useRef<HTMLDivElement>(null);
  /** Set by a send that landed in full: the bar has folded away, taking focus with it. */
  const refocusRef = React.useRef(false);

  const links = dedupe(items);
  const inReader = new Set(sentReader);
  const inInstapaper = new Set(sentInstapaper);
  const isSent = (url: string) => inReader.has(url) || inInstapaper.has(url);
  const unsent = links.filter((item) => !isSent(item.url)).map((item) => item.url);
  // Only what can still be sent counts as ticked: a link another tab sent meanwhile drops out.
  const ticked = unsent.filter((url) => selected.has(url));
  const count = ticked.length;
  const busy = sending !== null || inFlight;
  const allTicked = ticked.length === unsent.length;

  // The bar keeps its last count while it folds away, rather than reading "0 selected" for the
  // length of the collapse.
  const [shownCount, setShownCount] = React.useState(count);
  if (count > 0 && count !== shownCount) setShownCount(count);

  // After a send lands in full, focus follows it rather than dropping to the page: the pressed
  // button has folded away with the bar. The first link still to tick takes it, or the heading
  // row once there is none. Only acts on the render that follows a landed send, and only on focus
  // that was really lost.
  React.useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
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

  const send = async (destination: FurtherReadingDestination) => {
    if (busy || count === 0) return;
    setSending(destination);
    try {
      const result = await sendFurtherReading(postId, destination, ticked);
      // The server's list of what did not land is the truth: exactly those stay ticked, and a
      // full send leaves nothing.
      setSelected(new Set(result.unsent));
      refocusRef.current = result.unsent.length === 0;
    } catch {
      // The store has toasted; the ticks stay exactly as they were, so the retry is one press.
    } finally {
      setSending(null);
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

  const bar = (
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
  );

  const label = allTicked ? 'Deselect all' : 'Select all';
  return (
    <div ref={rootRef}>
      <div
        className={headingRowClass}
        data-testid="further-reading-heading-row"
        data-heading-row=""
        tabIndex={-1}
      >
        <h3 className={SECTION_HEADING_CLASS}>Further reading</h3>
        {unsent.length === 0 ? (
          <span className={statusClass}>
            <Check
              size={12}
              aria-hidden="true"
              className="text-accent-green"
              data-testid="further-reading-all-sent-check"
            />
            All sent
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`${label} Further reading`}
            onClick={() => {
              setSelected(allTicked ? new Set() : new Set([...selected, ...unsent]));
            }}
          >
            {label}
          </Button>
        )}
      </div>
      <ul className={listClass}>
        {links.map((item) => {
          if (isSent(item.url)) {
            const reader = inReader.has(item.url);
            return (
              <li key={item.url} className={cn(rowClass, 'items-start')}>
                <span aria-hidden="true" className={tickSlotClass}>
                  <Check
                    size={14}
                    className="text-accent-green"
                    data-testid="further-reading-sent-mark"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">{item.note}</span>
                </span>
                {reader ? (
                  <span
                    className={cn(statusClass, MODULE_ACCENT.reader.text, 'mt-px')}
                    data-testid="further-reading-in-reader"
                  >
                    <Check size={12} aria-hidden="true" />
                    In Reader
                  </span>
                ) : (
                  <span
                    className={cn(statusClass, 'mt-px')}
                    data-testid="further-reading-in-instapaper"
                  >
                    In Instapaper
                  </span>
                )}
                <OpenLink item={item} />
              </li>
            );
          }
          const isTicked = selected.has(item.url);
          return (
            <li key={item.url} className="flex items-start gap-1">
              <Button
                variant="ghost"
                role="checkbox"
                aria-checked={isTicked}
                disabled={busy}
                className={cn(tickRowClass, 'min-w-0 flex-1')}
                onKeyDown={ignoreEnter}
                onClick={() => {
                  toggle(item.url);
                }}
              >
                <span
                  aria-hidden="true"
                  data-testid="further-reading-tick"
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
                      data-testid="further-reading-tick-check"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">{item.note}</span>
                </span>
              </Button>
              <OpenLink item={item} />
            </li>
          );
        })}
      </ul>
      {bar}
    </div>
  );
}

export function FurtherReading(properties: FurtherReadingProperties) {
  const configured = useInstapaperConfigured();
  if (configured) return <Checklist {...properties} />;
  return (
    <section>
      <h3 className={SECTION_HEADING_CLASS}>Further reading</h3>
      <PlainLinks items={properties.items} />
    </section>
  );
}
