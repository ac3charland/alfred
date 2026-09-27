import { screen } from '@testing-library/react';
import * as React from 'react';

import { makeCommAccount, makeCommMessage } from '@/lib/comms/fixtures';
import { renderWithProviders } from '@/lib/test-utils';

import { ViewSwitcher } from './view-switcher';

// Mock next/navigation so the test controls the active route. The segments are now
// ViewLink anchors (a History-API switch since ALF-27), so a plain click calls
// history.pushState — stub it so jsdom doesn't actually mutate the test URL.
const mockPathname = jest.fn<string, []>(() => '/');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

// `useQueueCount` (ALF-222) needs a CommsProvider, so every render goes through
// `renderWithProviders` now instead of a bare `render` — with no messages seeded, the switcher's
// Comms badge stays at its default hidden-at-zero state and the existing exact-name assertions
// below ('Comms', not 'Comms 2') keep holding.
function render(ui: React.ReactElement) {
  return renderWithProviders(ui);
}

describe('ViewSwitcher', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/');
    jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
  });

  it('renders a segment per module as a link, found by its accessible name (ALF-270)', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Comms' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reader' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wiki' })).toBeInTheDocument();
  });

  it('points each segment at its module default view', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/priority');
    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('href', '/code');
    expect(screen.getByRole('link', { name: 'Comms' })).toHaveAttribute('href', '/comms');
    expect(screen.getByRole('link', { name: 'Reader' })).toHaveAttribute('href', '/reader');
    expect(screen.getByRole('link', { name: 'Wiki' })).toHaveAttribute('href', '/wiki');
  });

  it('shows no visible label text — each segment is an icon with a title hover hint (ALF-270)', () => {
    render(<ViewSwitcher />);

    for (const label of ['Tasks', 'Code', 'Comms', 'Reader', 'Wiki']) {
      const segment = screen.getByRole('link', { name: label });
      expect(segment).toHaveAttribute('title', label);
      expect(segment).not.toHaveTextContent(label);
      expect(segment.querySelector('svg')).toBeInTheDocument();
      expect(segment.querySelector('svg')).toHaveAttribute('aria-hidden');
    }
  });

  it('marks Wiki active on its landing route and on a page beneath it', () => {
    mockPathname.mockReturnValue('/wiki');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Wiki' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');

    mockPathname.mockReturnValue('/wiki/concepts/habit-stacking');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Wiki' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Wiki' })).toHaveClass('text-accent-violet');
  });

  it('marks Tasks active on the inbox/landing route', () => {
    mockPathname.mockReturnValue('/');
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Code' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Tasks active on the priority, a folder, and the completed route', () => {
    mockPathname.mockReturnValue('/priority');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

    mockPathname.mockReturnValue('/folders/f1');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

    mockPathname.mockReturnValue('/completed');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks Code active on the /code landing route', () => {
    mockPathname.mockReturnValue('/code');
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Code active on a project board route', () => {
    mockPathname.mockReturnValue('/code/abc-123');
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Comms active on its landing route and on a settings route beneath it', () => {
    mockPathname.mockReturnValue('/comms');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Comms' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');

    mockPathname.mockReturnValue('/comms/people');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Comms' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks Reader active on its landing route and on a route beneath it', () => {
    mockPathname.mockReturnValue('/reader');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Reader' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');

    mockPathname.mockReturnValue('/reader/archive');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Reader' })).toHaveAttribute('aria-current', 'page');
  });

  it('gives the active segment its OWN module accent, not one shared colour', () => {
    mockPathname.mockReturnValue('/code');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Code' })).toHaveClass('text-accent-teal');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveClass('text-accent-teal');

    // Comms is the blue module, so its active segment must not borrow the app's teal.
    mockPathname.mockReturnValue('/comms');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Comms' })).toHaveClass('text-accent-blue');
    expect(screen.getByRole('link', { name: 'Comms' })).not.toHaveClass('text-accent-teal');

    // Reader is the green module.
    mockPathname.mockReturnValue('/reader');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Reader' })).toHaveClass('text-accent-green');
    expect(screen.getByRole('link', { name: 'Reader' })).not.toHaveClass('text-accent-blue');
  });

  it('highlights active Tasks in amber, so it is not mistaken for Code (ALF-219)', () => {
    mockPathname.mockReturnValue('/priority');
    const { rerender } = render(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveClass('text-accent-amber');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveClass('text-accent-teal');

    // ...and Code keeps the teal, so the two highlights read as different modules.
    mockPathname.mockReturnValue('/code');
    rerender(<ViewSwitcher />);
    expect(screen.getByRole('link', { name: 'Code' })).not.toHaveClass('text-accent-amber');
  });

  it('exposes a labelled group for the switcher', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('group', { name: /switch module/i })).toBeInTheDocument();
  });

  it('fills its container rather than sizing to its content, so it cannot overflow (ALF-219)', () => {
    render(<ViewSwitcher />);

    const group = screen.getByRole('group', { name: /switch module/i });
    expect(group).toHaveClass('w-full');
    expect(group).toHaveClass('gap-0.5');
    // `w-fit` is what let a third segment push the control past the 224px sidebar.
    expect(group).not.toHaveClass('w-fit');
    expect(group).not.toHaveClass('justify-between');
  });

  it('gives every segment equal width, so no icon moves when the active module changes (ALF-270)', () => {
    render(<ViewSwitcher />);

    for (const label of ['Tasks', 'Code', 'Comms', 'Reader', 'Wiki']) {
      const segment = screen.getByRole('link', { name: label });
      // `flex-1` (equal basis) replaces the old `flex-auto` (content-sized) now that there is
      // no label whose own width the segment needs to start from — every cell is the same size
      // regardless of which module is active.
      expect(segment).toHaveClass('flex-1');
      expect(segment).not.toHaveClass('flex-auto');
      expect(segment).toHaveClass('min-w-0');
    }
  });

  it("puts Comms last, so its badge lands at the control's own end (ALF-222)", () => {
    render(<ViewSwitcher />);

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Tasks',
      'Code',
      'Reader',
      'Wiki',
      'Comms',
    ]);
  });

  it('badges the Comms segment with how many messages are waiting for a reply (ALF-222)', () => {
    const account = makeCommAccount('personal');
    renderWithProviders(<ViewSwitcher />, {
      comms: {
        accounts: [account],
        messages: [
          makeCommMessage(account.id, { tier: 'asap', judged_by: 'model' }),
          makeCommMessage(account.id, { tier: 'today', judged_by: 'model' }),
          // On the shelf, so uncounted.
          makeCommMessage(account.id, { tier: 'fyi', judged_by: 'model' }),
        ],
      },
    });

    expect(screen.getByLabelText('2 waiting for a reply')).toHaveTextContent('2');
    // The badge does not widen the segment: it stays an absolutely-positioned corner overlay.
    expect(screen.getByLabelText('2 waiting for a reply')).toHaveClass('absolute');
  });

  it('hides the Comms badge when nothing is owed — the resting state', () => {
    render(<ViewSwitcher />);

    expect(screen.getByRole('link', { name: 'Comms' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/waiting for a reply/)).not.toBeInTheDocument();
  });

  it('hides the Comms badge while unloaded, even though the failed seed carried queued rows', () => {
    const account = makeCommAccount('personal');
    renderWithProviders(<ViewSwitcher />, {
      comms: {
        accounts: [account],
        messages: [makeCommMessage(account.id, { tier: 'asap', judged_by: 'model' })],
        failed: true,
      },
    });

    expect(screen.queryByLabelText(/waiting for a reply/)).not.toBeInTheDocument();
  });
});
