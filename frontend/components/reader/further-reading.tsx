'use client';

import { ArrowUpRight, BookOpen, Check } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Button } from '@/components/atoms/button';
import { Spinner } from '@/components/atoms/spinner';
import { MODULE_ACCENT } from '@/lib/modules';
import {
  useFurtherReadingSendInFlight,
  useInstapaperConfigured,
  useReaderActions,
} from '@/lib/stores/reader-store';
import type { FurtherReadingDestination, ReaderFurtherReading } from '@/lib/types';
import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';
import { cn } from '@/lib/utils';

import {
  barClass,
  clearClass,
  counterClass,
  headingRowClass,
  listClass,
  rowClass,
  statusClass,
  tickBoxClass,
  tickRowClass,
  tickSlotClass,
} from './reader-checklist.styles';
import { ignoreEnter } from './wiki-picks';

/**
 * A post's Further reading: the linked sources the summariser judged worth reading in full, as a
 * checklist with its own selection and its own bar. Tick some, then send them to Instapaper —
 * into its "To Reader" folder, where the Reader takes them in and summarises them (Send to
 * Reader), or straight to Unread (Send to Instapaper). It is drawn like `WikiPicks` and shares its
 * chrome, but it is a separate selection on purpose: ticking a link never ticks a bullet, and the
 * two bars' different verbs sit apart, with the argument and the audience between them.
 *
 * Each row is a checkbox button holding the piece's title over the post's reason for linking it,
 * with a sibling ↗ that opens the link in a new tab — a sibling because a link cannot nest inside
 * a button. A link goes once: sent anywhere, its tick becomes a check and it reads "In Reader" (in
 * the Reader's green) or "In Instapaper", and Select all passes over it.
 *
 * A deployment with no Instapaper credentials can send nowhere, so the section is a plain list of
 * links there. Selection is this component's own state, keyed by URL (the sent marks are URLs
 * too); whether a send is in the air comes from the store, so a send started before the overview
 * was last opened still holds every control.
 */

export interface FurtherReadingProperties {
  postId: string;
  /** The items to draw, in link order. The overview mounts this only when there is one. */
  items: readonly ReaderFurtherReading[];
  /** Every URL already saved into "To Reader". */
  sentReader: readonly string[];
  /** Every URL already saved to Unread. */
  sentInstapaper: readonly string[];
}

const HEADING = 'Further reading';

const PLAIN_LIST_CLASS = 'mt-1 list-disc space-y-1 pl-5 text-sm text-foreground';
const PLAIN_LINK_CLASS = 'font-medium text-foreground underline-offset-4 hover:underline';
const NOTE_CLASS = 'text-muted-foreground';
/** The ↗ beside each row: an icon button's chrome, shrunk to sit level with the title line. */
const OPEN_LINK_CLASS = 'mt-0.5 h-7 w-7 shrink-0';

/** What each destination's button says, and the mark a link sent there wears. */
const DESTINATIONS: Readonly<
  Record<FurtherReadingDestination, { send: string; mark: string; markClass: string }>
> = {
  reader: { send: 'Send to Reader', mark: 'In Reader', markClass: MODULE_ACCENT.reader.text },
  instapaper: {
    send: 'Send to Instapaper',
    mark: 'In Instapaper',
    markClass: 'text-muted-foreground',
  },
};

/** The two lines every row shows: the piece's name, then why the post links it. */
function ItemText({ item }: { item: ReaderFurtherReading }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="font-medium">{item.title}</span>
      <span className={NOTE_CLASS}>{item.note}</span>
    </span>
  );
}

/** The ↗ that opens one link in a new tab, named for the piece it opens. */
function OpenLink({ item }: { item: ReaderFurtherReading }) {
  return (
    <Button asChild variant="ghost" size="icon" className={OPEN_LINK_CLASS}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${item.title}`}
      >
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </Button>
  );
}

/** A deployment that can send nowhere: each title is its link, and the note follows it. */
function PlainList({ items }: { items: readonly ReaderFurtherReading[] }) {
  return (
    <section>
      <h3 className={SECTION_HEADING_CLASS}>{HEADING}</h3>
      <ul className={PLAIN_LIST_CLASS}>
        {items.map((item) => (
          <li key={item.url}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={PLAIN_LINK_CLASS}
            >
              {item.title}
            </a>
            <span className={NOTE_CLASS}> — {item.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Checklist({ postId, items, sentReader, sentInstapaper }: FurtherReadingProperties) {
  const { sendFurtherReading } = useReaderActions();
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = React.useState<FurtherReadingDestination | undefined>();
  const inFlight = useFurtherReadingSendInFlight(postId);
  const rootRef = React.useRef<HTMLElement>(null);
  /** Set by a send that landed: the bar may have folded away, taking focus with it. */
  const refocusRef = React.useRef(false);

  // A URL in both lists reads "In Reader": that is where it will be summarised.
  const inReader = new Set(sentReader);
  const inInstapaper = new Set(sentInstapaper);
  const markOf = (url: string): FurtherReadingDestination | undefined => {
    if (inReader.has(url)) return 'reader';
    return inInstapaper.has(url) ? 'instapaper' : undefined;
  };
  const unsent = items.filter((item) => markOf(item.url) === undefined).map((item) => item.url);
  // Only what can still be sent counts as ticked — a link another tab sent meanwhile drops out.
  const ticked = unsent.filter((url) => selected.has(url));
  const count = ticked.length;
  const busy = sending !== undefined || inFlight;

  // The bar keeps its last count while it folds away, rather than reading "0 selected".
  const [shownCount, setShownCount] = React.useState(count);
  if (count > 0 && count !== shownCount) setShownCount(count);

  // After a send lands, focus follows it rather than dropping to the page — the same rule as the
  // wiki checklist: only focus that was really lost moves, to the first item still to tick, or the
  // heading row once there is none.
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
      const { unsent: left } = await sendFurtherReading(postId, destination, ticked);
      // What landed is marked now and drops out on its own; what didn't stays ticked, so the
      // retry is one press. Nothing else survives the send.
      setSelected(new Set(left));
      refocusRef.current = true;
    } catch {
      // The store has toasted; the ticks stay exactly as they were.
    } finally {
      setSending(undefined);
    }
  };

  const allTicked = count === unsent.length;
  const selectLabel = allTicked ? 'Deselect all' : 'Select all';

  const sendButton = (destination: FurtherReadingDestination) => (
    <Button
      variant={destination === 'reader' ? 'accent' : 'outline'}
      size="sm"
      disabled={busy}
      onClick={() => {
        void send(destination);
      }}
    >
      {sending === destination ? (
        <>
          <span aria-hidden="true" className="inline-flex">
            <Spinner size={14} label="Sending" />
          </span>
          Sending…
        </>
      ) : (
        <>
          {destination === 'reader' && <BookOpen size={14} aria-hidden="true" />}
          {DESTINATIONS[destination].send}
        </>
      )}
    </Button>
  );

  return (
    <section ref={rootRef} data-testid="further-reading">
      <div
        className={headingRowClass}
        data-testid="further-reading-heading-row"
        data-heading-row=""
        tabIndex={-1}
      >
        <h3 className={SECTION_HEADING_CLASS}>{HEADING}</h3>
        {unsent.length === 0 ? (
          <span className={statusClass}>
            <Check size={12} aria-hidden="true" data-testid="further-reading-all-sent-check" />
            All sent
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`${selectLabel} ${HEADING}`}
            onClick={() => {
              setSelected(allTicked ? new Set() : new Set([...selected, ...unsent]));
            }}
          >
            {selectLabel}
          </Button>
        )}
      </div>

      <ul className={listClass}>
        {items.map((item) => {
          const mark = markOf(item.url);
          if (mark !== undefined) {
            return (
              <li key={item.url} className={cn(rowClass, 'pr-0')}>
                <span aria-hidden="true" className={tickSlotClass}>
                  <Check
                    size={14}
                    className={DESTINATIONS[mark].markClass}
                    data-testid="further-reading-sent-mark"
                  />
                </span>
                <ItemText item={item} />
                <span className={cn(statusClass, 'mt-px', DESTINATIONS[mark].markClass)}>
                  {DESTINATIONS[mark].mark}
                </span>
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
                className={tickRowClass}
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
                  {isTicked && <Check size={10} className="text-background" strokeWidth={3} />}
                </span>
                <ItemText item={item} />
              </Button>
              <OpenLink item={item} />
            </li>
          );
        })}
      </ul>

      <AnimatedHeightCollapse open={count > 0} testId="further-reading-selection">
        <div role="group" aria-label="Selected links" className={barClass}>
          <span className={counterClass}>{shownCount} selected</span>
          {sendButton('reader')}
          {sendButton('instapaper')}
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

export function FurtherReading(properties: FurtherReadingProperties) {
  const configured = useInstapaperConfigured();
  return configured ? <Checklist {...properties} /> : <PlainList items={properties.items} />;
}
