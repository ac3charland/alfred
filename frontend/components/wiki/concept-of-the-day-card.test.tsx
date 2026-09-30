import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { WikiPageIndexRow } from '@/lib/types';
import { makeWikiPage, toWikiIndexRow } from '@/lib/wiki/fixtures';

import { ConceptOfTheDayCard } from './concept-of-the-day-card';

const PATH = 'wiki/concepts/habit-stacking.md';

function concept(overrides: Partial<WikiPageIndexRow> = {}): WikiPageIndexRow {
  return {
    ...toWikiIndexRow(
      makeWikiPage(PATH, {
        title: 'Habit stacking',
        summary: 'Anchoring a new behaviour to an existing routine rather than a clock time.',
        tags: ['habits', 'behaviour'],
      }),
    ),
    ...overrides,
  };
}

function renderCard(page = concept(), date = '2026-09-30') {
  render(<ConceptOfTheDayCard page={page} date={date} />);
  return screen.getByRole('region', { name: 'Concept of the day' });
}

describe('ConceptOfTheDayCard', () => {
  it('is a region labelled by its eyebrow', () => {
    const card = renderCard();

    expect(within(card).getByText('Concept of the day')).toBeInTheDocument();
    expect(card).toHaveAccessibleName('Concept of the day');
  });

  it('shows the eyebrow, the date, the title, the summary and every tag', () => {
    const card = renderCard();

    expect(within(card).getByText('Concept of the day')).toBeInTheDocument();
    expect(within(card).getByText('Wed, Sep 30')).toBeInTheDocument();
    expect(within(card).getByText('Habit stacking')).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Anchoring a new behaviour to an existing routine rather than a clock time.',
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText('habits')).toBeInTheDocument();
    expect(within(card).getByText('behaviour')).toBeInTheDocument();
  });

  it.each([
    ['2026-09-30', 'Wed, Sep 30'],
    ['2026-12-31', 'Thu, Dec 31'],
    ['2027-01-01', 'Fri, Jan 1'],
    ['2028-02-29', 'Tue, Feb 29'],
    ['2026-03-08', 'Sun, Mar 8'],
  ])('writes the date %s as %s, read from the date string itself', (date, expected) => {
    const card = renderCard(concept(), date);

    const time = within(card).getByText(expected);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', date);
    expect(time).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('sets the eyebrow in the wiki violet and the date at the far end of the same row', () => {
    const card = renderCard();

    const eyebrow = within(card).getByText('Concept of the day');
    const date = within(card).getByText('Wed, Sep 30');
    expect(eyebrow).toHaveClass('uppercase', 'text-accent-violet');
    expect(eyebrow.parentElement).toBe(date.parentElement);
    expect(eyebrow.parentElement).toHaveClass('justify-between');
  });

  it('leaves out the summary when it is empty', () => {
    const card = renderCard(concept({ summary: '', tags: [] }));

    expect(card).toHaveTextContent(/^Concept of the dayWed, Sep 30Habit stacking$/);
    // The eyebrow is the card's only paragraph: no empty summary line is left behind.
    expect(within(card).getAllByRole('paragraph')).toHaveLength(1);
  });

  it('leaves out the summary when it is only whitespace', () => {
    const card = renderCard(concept({ summary: ' \n\t ', tags: [] }));

    expect(within(card).getAllByRole('paragraph')).toHaveLength(1);
  });

  it('shows the summary as a second paragraph when there is one', () => {
    const card = renderCard(concept({ tags: [] }));

    expect(within(card).getAllByRole('paragraph')).toHaveLength(2);
    expect(within(card).getAllByRole('paragraph')[1]).toHaveClass(
      'text-sm',
      'text-muted-foreground',
    );
  });

  it('leaves out the tags when there are none, keeping the summary', () => {
    const card = renderCard(concept({ tags: [] }));

    expect(card).toHaveTextContent(
      /^Concept of the dayWed, Sep 30Habit stackingAnchoring a new behaviour to an existing routine rather than a clock time\.$/,
    );
  });

  it('shows the tags without a summary when only the summary is missing', () => {
    const card = renderCard(concept({ summary: '' }));

    expect(card).toHaveTextContent(/^Concept of the dayWed, Sep 30Habit stackinghabitsbehaviour$/);
  });

  it('draws each tag as a muted badge', () => {
    const card = renderCard();

    expect(within(card).getByText('habits')).toHaveClass('rounded-full', 'text-muted-foreground');
    expect(within(card).getByText('behaviour')).toHaveClass('border');
  });

  describe('the title link', () => {
    it("is named by the title alone and points at the page's in-app URL", () => {
      renderCard();

      const link = screen.getByRole('link', { name: 'Habit stacking' });
      expect(link).toHaveAttribute('href', '/wiki/concepts/habit-stacking');
      expect(screen.getAllByRole('link')).toHaveLength(1);
    });

    it('encodes a stem that would otherwise start a query or an anchor', () => {
      renderCard(concept({ path: 'wiki/concepts/why?.md', title: 'Why?', summary: '', tags: [] }));

      expect(screen.getByRole('link', { name: 'Why?' })).toHaveAttribute(
        'href',
        '/wiki/concepts/why%3F',
      );
    });

    it('opens the page client-side on a plain click', async () => {
      const pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
      const user = userEvent.setup();
      renderCard();

      await user.click(screen.getByRole('link', { name: 'Habit stacking' }));

      expect(pushState).toHaveBeenCalledWith(null, '', '/wiki/concepts/habit-stacking');
    });

    it('takes keyboard focus, and opens the page on Enter', async () => {
      const pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
      const user = userEvent.setup();
      renderCard();

      await user.tab();
      expect(screen.getByRole('link', { name: 'Habit stacking' })).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(pushState).toHaveBeenCalledWith(null, '', '/wiki/concepts/habit-stacking');
    });

    it('is a serif title, stretched over the whole card, with a focus ring', () => {
      renderCard();

      const link = screen.getByRole('link', { name: 'Habit stacking' });
      expect(link).toHaveClass('font-serif', 'text-2xl');
      expect(link).toHaveClass('after:absolute', 'after:inset-0');
      expect(link).toHaveClass(
        'focus:outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-ring',
      );
    });
  });

  describe('the frame', () => {
    it('is the surface card, edged and glowing in violet', () => {
      const card = renderCard();

      const frame = card.firstElementChild;
      expect(frame).toHaveClass('rounded-lg', 'border', 'bg-surface', 'p-4');
      expect(frame).toHaveClass('border-accent-violet/30', 'glow-violet');
      expect(frame).not.toHaveClass('border-border');
    });

    it("anchors the link's stretched area to the card and brightens the edge on hover", () => {
      const card = renderCard();

      const frame = card.firstElementChild;
      expect(frame).toHaveClass('relative');
      expect(frame).toHaveClass('hover:border-accent-violet/60');
      expect(frame).toHaveClass('transition-colors', 'motion-reduce:transition-none');
    });

    it('holds everything the card shows', () => {
      const card = renderCard();

      const frame = card.firstElementChild;
      expect(frame).toContainElement(screen.getByRole('link', { name: 'Habit stacking' }));
      expect(frame).toContainElement(within(card).getByText('Wed, Sep 30'));
    });
  });
});
