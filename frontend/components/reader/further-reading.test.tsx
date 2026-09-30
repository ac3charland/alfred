import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as api from '@/lib/api-client';
import {
  makeFurtherReading,
  makeReaderOverview,
  makeReaderPost,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import { useReaderPosts } from '@/lib/stores/reader-store';
import type {
  FurtherReadingSendResult,
  ReaderFurtherReading,
  ReaderPostListItem,
} from '@/lib/types';

import { FurtherReading } from './further-reading';
import { renderReader } from './test-helpers';

// A partial mock: the send is stubbed, but `ApiError` stays the real class, since the store
// quotes the route's own sentence from it.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  sendFurtherReading: jest.fn(),
}));
const mockApi = jest.mocked(api);

const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';
const POST_ID = '11111111-1111-4111-8111-111111111111';

const ITEMS = makeFurtherReading();
const [GAP, EVALS, FOLDBENCH, SCEPTIC] = ITEMS as [
  ReaderFurtherReading,
  ReaderFurtherReading,
  ReaderFurtherReading,
  ReaderFurtherReading,
];

interface Sent {
  reader?: string[];
  instapaper?: string[];
}

function post({ reader = [], instapaper = [] }: Sent = {}): ReaderPostListItem {
  const { text: _text, ...row } = makeReaderPost(PUBLICATION_ID, {
    id: POST_ID,
    summary_state: 'done',
    overview: makeReaderOverview({ further_reading: ITEMS }),
    further_sent_reader: reader,
    further_sent_instapaper: instapaper,
  });
  return row;
}

/** What the route answers: the row with the saved links marked, and the ones that did not go. */
function answer(sent: Sent, unsent: string[] = [], failure?: string): FurtherReadingSendResult {
  return { post: post(sent), unsent, ...(failure === undefined ? {} : { failure }) };
}

interface LiveOptions {
  items?: readonly ReaderFurtherReading[];
  instapaperConfigured?: boolean;
}

/** The checklist as the overview mounts it: fed from the store, so a reconciled send redraws it. */
function LiveFurtherReading({ items = ITEMS, instapaperConfigured = true }: LiveOptions) {
  const row = useReaderPosts().find((candidate) => candidate.id === POST_ID);
  if (row === undefined) return null;
  return (
    <FurtherReading
      postId={row.id}
      items={items}
      sentReader={row.further_sent_reader}
      sentInstapaper={row.further_sent_instapaper}
      instapaperConfigured={instapaperConfigured}
    />
  );
}

/** The section behind a toggle, so a test can unmount and remount it around a send. */
function Collapsible() {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        Toggle section
      </button>
      {open && <LiveFurtherReading />}
    </>
  );
}

function renderFurther(sent: Sent = {}, options: LiveOptions = {}) {
  return renderReader(<LiveFurtherReading {...options} />, [post(sent)], undefined, {
    instapaperConfigured: options.instapaperConfigured ?? true,
  });
}

/** A promise the test settles by hand, so one send can be held in flight. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick(item: ReaderFurtherReading): HTMLElement {
  return screen.getByRole('checkbox', { name: item.title });
}

/** The selection bar, which must be showing. */
function bar(): HTMLElement {
  return screen.getByRole('group', { name: 'Selected links' });
}

/** The selection bar, if it is showing — folded away, it leaves the accessibility tree. */
function queryBar(): HTMLElement | null {
  return screen.queryByRole('group', { name: 'Selected links' });
}

function sendToReader(): HTMLElement {
  return screen.getByRole('button', { name: 'Send to Reader' });
}

function sendToInstapaper(): HTMLElement {
  return screen.getByRole('button', { name: 'Send to Instapaper' });
}

/** The list row a link's title sits in. */
function rowOf(item: ReaderFurtherReading): HTMLElement {
  const row = screen.getByText(item.title).closest('li');
  if (row === null) throw new Error(`no row for ${item.title}`);
  return row;
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('FurtherReading — the checklist', () => {
  it('heads the section "Further reading" and draws every item as an unticked checkbox', () => {
    renderFurther();

    expect(screen.getByRole('heading', { level: 3, name: 'Further reading' })).toBeInTheDocument();
    for (const item of ITEMS) expect(tick(item)).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByRole('checkbox')).toHaveLength(ITEMS.length);
  });

  it('holds the title in medium weight and the note muted, both inside the checkbox', () => {
    renderFurther();

    const box = tick(GAP);
    expect(within(box).getByText(GAP.title)).toHaveClass('font-medium');
    expect(within(box).getByText(GAP.note)).toHaveClass('text-muted-foreground');
    expect(box).toHaveAccessibleDescription(GAP.note);
  });

  it('ticks and unticks an item by a click anywhere on its row', async () => {
    const user = userEvent.setup();
    renderFurther();

    await user.click(screen.getByText(EVALS.note));
    expect(tick(EVALS)).toHaveAttribute('aria-checked', 'true');
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();

    await user.click(tick(EVALS));
    expect(tick(EVALS)).toHaveAttribute('aria-checked', 'false');
  });

  it('ticks a focused item with Space, and never with Enter', async () => {
    const user = userEvent.setup();
    renderFurther();

    tick(FOLDBENCH).focus();
    await user.keyboard('{Enter}');
    expect(tick(FOLDBENCH)).toHaveAttribute('aria-checked', 'false');

    await user.keyboard(' ');
    expect(tick(FOLDBENCH)).toHaveAttribute('aria-checked', 'true');
  });

  it('draws the tick box in the shared checklist classes', async () => {
    const user = userEvent.setup();
    renderFurther();

    const box = within(tick(GAP)).getByTestId('further-reading-tick');
    expect(box).toHaveClass('h-6', 'w-6', 'md:h-4', 'md:w-4', 'border-muted-foreground/50');
    expect(box).not.toHaveClass('bg-accent-teal');

    await user.click(tick(GAP));

    expect(within(tick(GAP)).getByTestId('further-reading-tick')).toHaveClass(
      'border-accent-teal',
      'bg-accent-teal',
    );
    expect(within(tick(GAP)).getByTestId('further-reading-tick-check')).toHaveAttribute(
      'width',
      '10',
    );
  });

  it('draws a repeated URL once', () => {
    renderFurther({}, { items: [GAP, GAP, EVALS] });

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});

describe('FurtherReading — the open link', () => {
  it('gives every item its own link, opening the URL in a new tab', () => {
    renderFurther();

    for (const item of ITEMS) {
      const link = screen.getByRole('link', { name: `Open ${item.title}` });
      expect(link).toHaveAttribute('href', item.url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('is a sibling of the checkbox, never inside it, and does not tick the row', async () => {
    const user = userEvent.setup();
    renderFurther();

    const link = screen.getByRole('link', { name: `Open ${GAP.title}` });
    expect(tick(GAP)).not.toContainElement(link);
    expect(within(tick(GAP)).queryByRole('link')).not.toBeInTheDocument();
    expect(rowOf(GAP)).toContainElement(link);
    expect(rowOf(GAP)).toContainElement(tick(GAP));

    // Stop the click from navigating the test window.
    link.addEventListener('click', (event) => {
      event.preventDefault();
    });
    await user.click(link);
    expect(tick(GAP)).toHaveAttribute('aria-checked', 'false');
  });
});

describe('FurtherReading — Select all', () => {
  it('names its button for the section', () => {
    renderFurther();

    expect(screen.getByRole('button', { name: 'Select all Further reading' })).toHaveTextContent(
      'Select all',
    );
  });

  it('ticks every unsent item, sends nothing, and reads Deselect all', async () => {
    const user = userEvent.setup();
    renderFurther({ reader: [GAP.url] });

    await user.click(screen.getByRole('button', { name: 'Select all Further reading' }));

    for (const item of [EVALS, FOLDBENCH, SCEPTIC]) {
      expect(tick(item)).toHaveAttribute('aria-checked', 'true');
    }
    expect(within(bar()).getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deselect all Further reading' })).toHaveTextContent(
      'Deselect all',
    );
    expect(mockApi.sendFurtherReading).not.toHaveBeenCalled();
  });

  it('reads Deselect all exactly when every unsent item is ticked, however they got ticked', async () => {
    const user = userEvent.setup();
    renderFurther({ instapaper: [GAP.url, EVALS.url] });

    await user.click(tick(FOLDBENCH));
    expect(screen.getByRole('button', { name: 'Select all Further reading' })).toBeInTheDocument();
    await user.click(tick(SCEPTIC));
    expect(
      screen.getByRole('button', { name: 'Deselect all Further reading' }),
    ).toBeInTheDocument();
  });

  it('unticks everything on Deselect all', async () => {
    const user = userEvent.setup();
    renderFurther();
    await user.click(screen.getByRole('button', { name: 'Select all Further reading' }));

    await user.click(screen.getByRole('button', { name: 'Deselect all Further reading' }));

    for (const item of ITEMS) expect(tick(item)).toHaveAttribute('aria-checked', 'false');
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('replaces Select all with "All sent" and a check once nothing is left to send', () => {
    renderFurther({ reader: [GAP.url, EVALS.url], instapaper: [FOLDBENCH.url, SCEPTIC.url] });

    expect(screen.getByText('All sent')).toBeInTheDocument();
    expect(screen.getByTestId('further-reading-all-sent-check')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Select all|Deselect all/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('gives the heading row a 32px height and a keyboard focus ring', () => {
    renderFurther();

    expect(screen.getByTestId('further-reading-heading-row')).toHaveClass(
      'min-h-8',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
    );
  });
});

describe('FurtherReading — the selection bar', () => {
  it('stays folded away while nothing is ticked, and opens at one tick', async () => {
    const user = userEvent.setup();
    renderFurther();

    expect(queryBar()).not.toBeInTheDocument();
    expect(screen.getByTestId('further-reading-selection')).toHaveClass('grid-rows-[0fr]');

    await user.click(tick(GAP));

    expect(screen.getByTestId('further-reading-selection')).toHaveClass('grid-rows-[1fr]');
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();
  });

  it('offers Send to Reader (accent, with an icon), Send to Instapaper (outline) and Clear', async () => {
    const user = userEvent.setup();
    renderFurther();
    await user.click(tick(GAP));

    expect(sendToReader()).toHaveClass('bg-accent-teal');
    expect(sendToReader().querySelector('svg')).not.toBeNull();
    expect(sendToInstapaper()).toHaveClass('border', 'border-border');
    expect(sendToInstapaper()).not.toHaveClass('bg-accent-teal');
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveClass('px-2');
    expect(within(bar()).getByText('1 selected')).toHaveClass('mr-2', 'text-accent-teal');
  });

  it('unticks everything on Clear and folds away', async () => {
    const user = userEvent.setup();
    renderFurther();
    await user.click(tick(GAP));
    await user.click(tick(SCEPTIC));

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(tick(GAP)).toHaveAttribute('aria-checked', 'false');
    expect(tick(SCEPTIC)).toHaveAttribute('aria-checked', 'false');
    expect(queryBar()).not.toBeInTheDocument();
  });

  it('sits after the list, under the section it belongs to', async () => {
    const user = userEvent.setup();
    renderFurther();
    await user.click(tick(GAP));

    const section = screen.getByRole('heading', { name: 'Further reading' }).closest('section');
    if (section === null) throw new Error('no section');
    const list = within(section).getByRole('list');
    expect(within(section).getByRole('group', { name: 'Selected links' })).toBe(bar());
    expect(list.compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(
      0,
    );
  });
});

describe('FurtherReading — sending', () => {
  it('sends the ticked URLs to the Reader, in the order the list draws them', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockResolvedValue(answer({ reader: [EVALS.url, SCEPTIC.url] }));
    renderFurther();

    // Ticked out of list order: the send still names them in the order the list draws them.
    await user.click(tick(SCEPTIC));
    await user.click(tick(EVALS));
    await user.click(sendToReader());

    await waitFor(() => {
      expect(queryBar()).not.toBeInTheDocument();
    });
    expect(mockApi.sendFurtherReading).toHaveBeenCalledTimes(1);
    expect(mockApi.sendFurtherReading).toHaveBeenCalledWith(POST_ID, {
      destination: 'reader',
      urls: [EVALS.url, SCEPTIC.url],
    });
  });

  it('sends the ticked URLs to Instapaper with the instapaper destination', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockResolvedValue(answer({ instapaper: [FOLDBENCH.url] }));
    renderFurther();

    await user.click(tick(FOLDBENCH));
    await user.click(sendToInstapaper());

    await waitFor(() => {
      expect(queryBar()).not.toBeInTheDocument();
    });
    expect(mockApi.sendFurtherReading).toHaveBeenCalledWith(POST_ID, {
      destination: 'instapaper',
      urls: [FOLDBENCH.url],
    });
  });

  it('draws the sent items as sent and unticks everything once a send lands', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockResolvedValue(answer({ reader: [GAP.url, EVALS.url] }));
    renderFurther();
    await user.click(tick(GAP));
    await user.click(tick(EVALS));

    await user.click(sendToReader());

    expect(await screen.findAllByText('In Reader')).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: GAP.title })).not.toBeInTheDocument();
    expect(tick(FOLDBENCH)).toHaveAttribute('aria-checked', 'false');
    expect(queryBar()).not.toBeInTheDocument();
    // A landed send is silent: the marks are the confirmation.
    expect(screen.queryByText(/^Sent \d+ of \d+/)).not.toBeInTheDocument();
  });

  it('disables every control while a send is in flight, and the pressed button reads Sending…', async () => {
    const user = userEvent.setup();
    const sending = deferred<FurtherReadingSendResult>();
    mockApi.sendFurtherReading.mockReturnValue(sending.promise);
    renderFurther();
    await user.click(tick(GAP));
    await user.click(tick(EVALS));

    await user.click(sendToInstapaper());

    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select all Further reading' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(sendToReader()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send to Instapaper' })).not.toBeInTheDocument();
    const pressed = screen.getByRole('button', { name: 'Sending…' });
    expect(pressed).toBeDisabled();
    expect(within(pressed).getByRole('status', { hidden: true })).toBeInTheDocument();

    // A second press cannot start a second send.
    await user.click(pressed);
    expect(mockApi.sendFurtherReading).toHaveBeenCalledTimes(1);

    sending.resolve(answer({ instapaper: [GAP.url, EVALS.url] }));
    expect(await screen.findAllByText('In Instapaper')).toHaveLength(2);
  });

  it('puts "Sending…" on the Reader button when that is the one pressed', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockReturnValue(new Promise(() => {}));
    renderFurther();
    await user.click(tick(GAP));

    await user.click(sendToReader());

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(sendToInstapaper()).toBeDisabled();
  });

  it('dims only the tick boxes while a send is in flight, never the text', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockReturnValue(new Promise(() => {}));
    renderFurther();
    await user.click(tick(GAP));

    await user.click(sendToReader());

    expect(tick(EVALS)).toHaveClass('disabled:opacity-100');
    expect(within(tick(EVALS)).getByTestId('further-reading-tick')).toHaveClass('opacity-50');
  });

  it('holds the controls of a remounted section while the store still has a send in flight', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockReturnValue(new Promise(() => {}));
    renderReader(<Collapsible />, [post()]);
    await user.click(tick(GAP));
    await user.click(sendToReader());

    // Fold the section away and open it again, as collapsing the overview does.
    await user.click(screen.getByRole('button', { name: 'Toggle section' }));
    await user.click(screen.getByRole('button', { name: 'Toggle section' }));

    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select all Further reading' })).toBeDisabled();
  });

  it('keeps only the unsent items ticked after a partial send, and toasts what stopped the rest', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockResolvedValue(
      answer({ reader: [GAP.url] }, [EVALS.url], "Instapaper didn't answer"),
    );
    renderFurther();
    await user.click(tick(GAP));
    await user.click(tick(EVALS));

    await user.click(sendToReader());

    expect(
      await screen.findByText("Sent 1 of 2 to Reader — Instapaper didn't answer for the other"),
    ).toBeInTheDocument();
    expect(within(rowOf(GAP)).getByText('In Reader')).toBeInTheDocument();
    expect(tick(EVALS)).toHaveAttribute('aria-checked', 'true');
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();
    expect(sendToReader()).toBeEnabled();
    expect(tick(EVALS)).toBeEnabled();
  });

  it('keeps every tick exactly as it was when nothing landed, and toasts the route’s sentence', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockRejectedValue(
      new api.ApiError('API POST failed: 409', 409, 'There is no “To Reader” folder in Instapaper'),
    );
    renderFurther();
    await user.click(tick(EVALS));
    await user.click(tick(FOLDBENCH));

    await user.click(sendToReader());

    expect(
      await screen.findByText('There is no “To Reader” folder in Instapaper'),
    ).toBeInTheDocument();
    expect(tick(EVALS)).toHaveAttribute('aria-checked', 'true');
    expect(tick(FOLDBENCH)).toHaveAttribute('aria-checked', 'true');
    expect(tick(GAP)).toHaveAttribute('aria-checked', 'false');
    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
    expect(sendToReader()).toBeEnabled();
    expect(tick(EVALS)).toBeEnabled();
  });

  it('moves focus to the first item still to tick when a send folds the bar away', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockResolvedValue(answer({ reader: [GAP.url] }));
    renderFurther();
    await user.click(tick(GAP));

    await user.click(sendToReader());

    await waitFor(() => {
      expect(tick(EVALS)).toHaveFocus();
    });
  });

  it('moves focus to the heading row when nothing is left to send', async () => {
    const user = userEvent.setup();
    mockApi.sendFurtherReading.mockResolvedValue(
      answer({ reader: [GAP.url, EVALS.url, FOLDBENCH.url, SCEPTIC.url] }),
    );
    renderFurther({ reader: [GAP.url, EVALS.url, FOLDBENCH.url] });
    await user.click(tick(SCEPTIC));

    await user.click(sendToReader());

    expect(await screen.findByText('All sent')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('further-reading-heading-row')).toHaveFocus();
    });
  });
});

describe('FurtherReading — sent items', () => {
  it('marks an item sent to the Reader "In Reader" in the module green, with the tick slot a check', () => {
    renderFurther({ reader: [GAP.url] });

    const row = rowOf(GAP);
    const status = within(row).getByText('In Reader');
    expect(status).toHaveClass('text-accent-green');
    expect(within(row).getByTestId('further-reading-sent-mark')).toBeInTheDocument();
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('marks an item sent to Instapaper "In Instapaper" in muted text', () => {
    renderFurther({ instapaper: [EVALS.url] });

    const status = within(rowOf(EVALS)).getByText('In Instapaper');
    expect(status).toHaveClass('text-muted-foreground');
    expect(status).not.toHaveClass('text-accent-green');
  });

  it('shows "In Reader" alone for a URL in both sent arrays', () => {
    renderFurther({ reader: [FOLDBENCH.url], instapaper: [FOLDBENCH.url] });

    const row = rowOf(FOLDBENCH);
    expect(within(row).getByText('In Reader')).toBeInTheDocument();
    expect(within(row).queryByText('In Instapaper')).not.toBeInTheDocument();
  });

  it('keeps the title, the note and the open link on a sent item, and never lets it be ticked', async () => {
    const user = userEvent.setup();
    renderFurther({ reader: [GAP.url] });

    const row = rowOf(GAP);
    expect(within(row).getByText(GAP.note)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: `Open ${GAP.title}` })).toHaveAttribute(
      'href',
      GAP.url,
    );
    await user.click(within(row).getByText(GAP.title));

    expect(queryBar()).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(ITEMS.length - 1);
  });

  it('counts only unsent items in Select all', async () => {
    const user = userEvent.setup();
    renderFurther({ reader: [GAP.url], instapaper: [EVALS.url] });

    await user.click(screen.getByRole('button', { name: 'Select all Further reading' }));

    expect(within(bar()).getByText('2 selected')).toBeInTheDocument();
  });
});

describe('FurtherReading — without Instapaper', () => {
  it('is a plain bulleted list of links: each title the link, followed by its note', () => {
    renderFurther({}, { instapaperConfigured: false });

    expect(screen.getByRole('heading', { level: 3, name: 'Further reading' })).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(list).toHaveClass('list-disc');
    expect(within(list).getAllByRole('listitem')).toHaveLength(ITEMS.length);
    for (const item of ITEMS) {
      const link = within(list).getByRole('link', { name: item.title });
      expect(link).toHaveAttribute('href', item.url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link.closest('li')).toHaveTextContent(`${item.title} — ${item.note}`);
    }
  });

  it('draws no tick, no Select all and no bar', () => {
    renderFurther({ reader: [GAP.url] }, { instapaperConfigured: false });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(queryBar()).not.toBeInTheDocument();
    expect(screen.queryByText('In Reader')).not.toBeInTheDocument();
    expect(screen.queryByText('All sent')).not.toBeInTheDocument();
  });

  it('needs no store: it renders bare, with no provider around it', () => {
    // A plain render, not renderReader — nothing here may read a store.
    renderFurtherBare();

    expect(screen.getAllByRole('link')).toHaveLength(ITEMS.length);
  });
});

function renderFurtherBare() {
  return render(
    <FurtherReading
      postId={POST_ID}
      items={ITEMS}
      sentReader={[]}
      sentInstapaper={[]}
      instapaperConfigured={false}
    />,
  );
}
