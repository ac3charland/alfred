'use client';

import { BookPlus, Check } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Button } from '@/components/atoms/button';
import { Spinner } from '@/components/atoms/spinner';
import { checkboxIncompleteClass, checkboxSizeClass } from '@/components/tasks/task-row.styles';
import { isBullet } from '@/lib/reader/overview';
import { useReaderActions, useWikiSendInFlight } from '@/lib/stores/reader-store';
import { SECTION_HEADING_CLASS } from '@/lib/ui/section-heading-class';
import { cn } from '@/lib/utils';

/**
 * A post's Novel ideas and Evidence as two checklists over ONE selection with one dispatch: tick
 * the bullets worth keeping in either section, then send them together, so one article reaches
 * the wiki as one send — one folder, one commit, one kickoff — with its claims and their support
 * side by side. It is the Inbox's select-then-Dispatch gesture in miniature, reusing its tick box
 * and its bulk bar's counter and accent button, laid inline under the last checklist section
 * rather than floating.
 *
 * Each checklist section's heading row carries Select all, which ticks that section's unsent
 * bullets and sends nothing: the bar's Send to wiki is the only control that sends, because
 * every send is a push the wiki may run a whole ingest session for, and one press should never
 * split a post across two of them.
 *
 * Each section decides for itself whether it is a checklist: one with no bullet to pick draws
 * its honest empty line instead, at its normal height. The overview mounts this only when at
 * least one section is.
 *
 * Selection is this component's own state, keyed by section and bullet text (a bullet has no id,
 * and the sent marks are recorded as text too), so collapsing the overview drops it; an idea and
 * an evidence bullet with the same text are two picks. Whether a send is in the air at all comes
 * from the store: the checklist remounts each time the overview opens, and a send started before
 * that must still hold every control. The write itself lives in the store action, so a send
 * whose row is collapsed mid-flight still lands. Selection and the primary action wear the app's
 * standard teal; violet is kept for the wiki's own marks — the sent checks.
 */

type SectionKey = 'ideas' | 'evidence';

const SECTION_KEYS: readonly SectionKey[] = ['ideas', 'evidence'];

export interface WikiPicksSection {
  /** The section's heading text — also what its Select all is named for. */
  heading: string;
  /** The overview's bullets, in the order the model returned them. */
  bullets: readonly string[];
  /** The exact text of every bullet in this section already sent. */
  sent: readonly string[];
  /** Drawn under the heading instead of a checklist when the section has no bullet to pick. */
  empty: React.ReactNode;
}

export interface WikiPicksProperties {
  postId: string;
  ideas: WikiPicksSection;
  evidence: WikiPicksSection;
}

type Selection = Readonly<Record<SectionKey, ReadonlySet<string>>>;

const EMPTY_SELECTION: Selection = { ideas: new Set(), evidence: new Set() };

/** Each section's heading-row test id — `novel-ideas-heading-row`, `evidence-heading-row`. */
const HEADING_ROW_TEST_ID: Readonly<Record<SectionKey, string>> = {
  ideas: 'novel-ideas-heading-row',
  evidence: 'evidence-heading-row',
};

/**
 * The heading row, only while the section's controls render: 32px, the Select all button's
 * height, so the heading doesn't jump when the button swaps for "All sent".
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
 * The counter's and Clear's spacing, even about Send to wiki: with the bar's `gap-2`, the
 * counter's `mr-2` and Clear's own `px-2` (narrowing the sm size's `px-3`) put each 16px from the
 * button. Clear's padding would otherwise add to the gap on its side only.
 */
const counterClass = 'mr-2 text-sm font-semibold text-accent-teal';
const clearClass = 'px-2';

/**
 * The ARIA checkbox pattern toggles on Space only. A `<button>` also clicks on Enter, so the
 * keydown's default is stopped there — Enter on a bullet does nothing.
 */
function ignoreEnter(event: React.KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter') event.preventDefault();
}

/** What one section draws from: its real bullets, its sent marks, and what is left to pick. */
interface SectionState {
  bullets: string[];
  sent: ReadonlySet<string>;
  /** Each unsent bullet once, in overview order: a repeated bullet is one pick. */
  unsent: string[];
  /** Only what can still be sent counts as ticked — a bullet another tab sent meanwhile drops out. */
  ticked: string[];
  isChecklist: boolean;
}

function sectionState(section: WikiPicksSection, selected: ReadonlySet<string>): SectionState {
  const bullets = section.bullets.filter((bullet) => isBullet(bullet));
  const sent = new Set(section.sent);
  const unsent = [...new Set(bullets)].filter((bullet) => !sent.has(bullet));
  return {
    bullets,
    sent,
    unsent,
    ticked: unsent.filter((bullet) => selected.has(bullet)),
    isChecklist: bullets.length > 0,
  };
}

export function WikiPicks({ postId, ideas, evidence }: WikiPicksProperties) {
  const sections: Readonly<Record<SectionKey, WikiPicksSection>> = { ideas, evidence };
  const { sendPicksToWiki } = useReaderActions();
  const [selected, setSelected] = React.useState<Selection>(EMPTY_SELECTION);
  const [sending, setSending] = React.useState(false);
  const inFlight = useWikiSendInFlight(postId);
  const rootRef = React.useRef<HTMLDivElement>(null);
  /** Set by a landed send: the bar has folded away, taking focus with it. */
  const refocusRef = React.useRef(false);

  const state: Readonly<Record<SectionKey, SectionState>> = {
    ideas: sectionState(ideas, selected.ideas),
    evidence: sectionState(evidence, selected.evidence),
  };
  const count = state.ideas.ticked.length + state.evidence.ticked.length;
  const busy = sending || inFlight;
  // The bar sits under the last section that is a checklist.
  const barSection: SectionKey = state.evidence.isChecklist ? 'evidence' : 'ideas';

  // The bar keeps its last count while it folds away, rather than reading "0 selected" for the
  // length of the collapse.
  const [shownCount, setShownCount] = React.useState(count);
  if (count > 0 && count !== shownCount) setShownCount(count);

  // After a send lands, focus follows it rather than dropping to the page: the pressed button has
  // folded away with the bar. The first bullet still to tick, in either section, takes it, or the
  // first checklist's heading row once there is none. Runs after every render, and only acts on
  // the one that follows a landed send — by then the sent bullets are drawn and the controls
  // re-enabled.
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

  const toggle = (key: SectionKey, bullet: string) => {
    setSelected((current) => {
      const next = new Set(current[key]);
      if (next.has(bullet)) next.delete(bullet);
      else next.add(bullet);
      return { ...current, [key]: next };
    });
  };

  /** Select all ticks every unsent bullet in its section; Deselect all unticks that section. */
  const toggleSection = (key: SectionKey, selectAll: boolean) => {
    setSelected((current) => ({
      ...current,
      [key]: selectAll ? new Set([...current[key], ...state[key].unsent]) : new Set(),
    }));
  };

  const send = async () => {
    if (busy || count === 0) return;
    setSending(true);
    try {
      await sendPicksToWiki(postId, {
        ideas: state.ideas.ticked,
        evidence: state.evidence.ticked,
      });
      // Not redundant with the sent filter: the server's row is the truth, and a tick on a
      // bullet it did not mark (a re-summarise reworded it, say) must not survive the send.
      setSelected(EMPTY_SELECTION);
      refocusRef.current = true;
    } catch {
      // The store has toasted; the ticks stay exactly as they were, so the retry is one press.
    } finally {
      setSending(false);
    }
  };

  const renderHeadingRow = (key: SectionKey) => {
    const { heading } = sections[key];
    const { unsent, ticked } = state[key];
    // Deselect all whenever every unsent bullet is ticked, however they got ticked; sent
    // bullets never count.
    const allTicked = ticked.length === unsent.length;
    const label = allTicked ? 'Deselect all' : 'Select all';
    return (
      <div
        className={headingRowClass}
        data-testid={HEADING_ROW_TEST_ID[key]}
        data-heading-row=""
        tabIndex={-1}
      >
        <h3 className={SECTION_HEADING_CLASS}>{heading}</h3>
        {unsent.length === 0 ? (
          <span className={statusClass}>
            <Check
              size={12}
              aria-hidden="true"
              className="text-accent-violet"
              data-testid="wiki-picks-all-sent-check"
            />
            All sent to wiki
          </span>
        ) : (
          // Both sections' visible labels are identical, so each is named for its section.
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`${label} ${heading}`}
            onClick={() => {
              toggleSection(key, !allTicked);
            }}
          >
            {label}
          </Button>
        )}
      </div>
    );
  };

  const renderList = (key: SectionKey) => {
    const { bullets, sent } = state[key];
    const picked = selected[key];
    return (
      <ul className={listClass}>
        {bullets.map((bullet, index) => {
          const rowKey = `${String(index)}:${bullet}`;
          if (sent.has(bullet)) {
            return (
              <li key={rowKey} className={rowClass}>
                <span aria-hidden="true" className={tickSlotClass}>
                  <Check
                    size={14}
                    className="text-accent-violet"
                    data-testid="wiki-pick-sent-mark"
                  />
                </span>
                <span className="min-w-0 flex-1">{bullet}</span>
                <span className={cn(statusClass, 'mt-px')}>
                  <Check
                    size={12}
                    aria-hidden="true"
                    className="text-accent-violet"
                    data-testid="wiki-pick-sent-check"
                  />
                  Sent
                </span>
              </li>
            );
          }
          const isTicked = picked.has(bullet);
          return (
            <li key={rowKey}>
              <Button
                variant="ghost"
                role="checkbox"
                aria-checked={isTicked}
                disabled={busy}
                className={tickRowClass}
                onKeyDown={ignoreEnter}
                onClick={() => {
                  toggle(key, bullet);
                }}
              >
                <span
                  aria-hidden="true"
                  data-testid="wiki-pick-tick"
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
                      data-testid="wiki-pick-tick-check"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">{bullet}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    );
  };

  // The spinner is decoration beside the word: hidden, so the button's name is just "Sending…".
  const bar = (
    <AnimatedHeightCollapse open={count > 0} testId="wiki-picks-selection">
      <div role="group" aria-label="Selected bullets" className={barClass}>
        <span className={counterClass}>{shownCount} selected</span>
        <Button
          variant="accent"
          size="sm"
          disabled={busy}
          onClick={() => {
            void send();
          }}
        >
          {sending ? (
            <>
              <span aria-hidden="true" className="inline-flex">
                <Spinner size={14} label="Sending" />
              </span>
              Sending…
            </>
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
          className={clearClass}
          disabled={busy}
          onClick={() => {
            setSelected(EMPTY_SELECTION);
          }}
        >
          Clear
        </Button>
      </div>
    </AnimatedHeightCollapse>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {SECTION_KEYS.map((key) => (
        <section key={key}>
          {state[key].isChecklist ? (
            <>
              {renderHeadingRow(key)}
              {renderList(key)}
              {key === barSection && bar}
            </>
          ) : (
            <>
              <h3 className={SECTION_HEADING_CLASS}>{sections[key].heading}</h3>
              {sections[key].empty}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
