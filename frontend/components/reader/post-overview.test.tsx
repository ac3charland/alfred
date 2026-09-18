import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { makeReaderOverview } from '@/lib/reader/fixtures';

import { PostOverview } from './post-overview';

describe('PostOverview', () => {
  it('renders all four sections in order', () => {
    render(<PostOverview overview={makeReaderOverview()} />);

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Novel ideas', 'Evidence', 'The argument', 'Who should read it']);
  });

  it('renders each novel idea and each piece of evidence as its own bullet', () => {
    render(
      <PostOverview
        overview={makeReaderOverview({
          novel_ideas: ['Idea one', 'Idea two'],
          evidence: ['Evidence one'],
        })}
      />,
    );

    expect(screen.getByText('Idea one')).toBeInTheDocument();
    expect(screen.getByText('Idea two')).toBeInTheDocument();
    expect(screen.getByText('Evidence one')).toBeInTheDocument();
  });

  it('states the honest empty answer when novel_ideas is empty', () => {
    render(<PostOverview overview={makeReaderOverview({ novel_ideas: [] })} />);

    expect(
      screen.getByText('Nothing new — the post restates what a well-read reader already knows.'),
    ).toBeInTheDocument();
  });

  it('states the honest empty answer when evidence is empty', () => {
    render(<PostOverview overview={makeReaderOverview({ evidence: [] })} />);

    expect(screen.getByText('None — the post rests on assertion alone.')).toBeInTheDocument();
  });

  it('renders the argument and who-should-read paragraphs', () => {
    render(
      <PostOverview
        overview={makeReaderOverview({
          argument: 'The argument paragraph.',
          who_should_read: 'Everyone who cares.',
        })}
      />,
    );

    expect(screen.getByText('The argument paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Everyone who cares.')).toBeInTheDocument();
  });
});
