import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { ClassificationMark } from './classification-mark';

/**
 * The glyph's identity: lucide stamps every icon's svg with a `lucide-<icon-name>` class, so the
 * three origins are told apart by shape here rather than by a test id.
 */
function glyphClassOf(mark: HTMLElement): string {
  const svg = mark.querySelector('svg');
  if (!svg) throw new Error('the mark rendered no glyph');
  return svg.getAttribute('class') ?? '';
}

describe('ClassificationMark', () => {
  it('draws a sparkle named "Labelled by the classifier" for a model-classified row', () => {
    render(<ClassificationMark origin="model" />);

    const mark = screen.getByRole('img', { name: 'Labelled by the classifier' });
    expect(glyphClassOf(mark)).toContain('lucide-sparkle');
  });

  it('draws a pencil named "Labelled by you" for a row the owner claimed', () => {
    render(<ClassificationMark origin="claimed" />);

    const mark = screen.getByRole('img', { name: 'Labelled by you' });
    expect(glyphClassOf(mark)).toContain('lucide-pencil');
  });

  it('draws a dashed circle named "Not yet classified" for an unjudged row', () => {
    render(<ClassificationMark origin="unjudged" />);

    const mark = screen.getByRole('img', { name: 'Not yet classified' });
    expect(glyphClassOf(mark)).toContain('lucide-circle-dashed');
  });

  it('repeats the accessible name as a native title, so a pointer hover reveals the same words', () => {
    render(<ClassificationMark origin="model" />);

    expect(screen.getByRole('img', { name: 'Labelled by the classifier' })).toHaveAttribute(
      'title',
      'Labelled by the classifier',
    );
  });

  // Provenance is a fact about the past, not a task in the present: the mark answers "where did
  // these labels come from?" and offers nothing to do about it. It also renders inside the
  // select-mode row's single <button>, where a nested control would be invalid HTML.
  it('is inert — a plain span, not a button, and not focusable', () => {
    render(<ClassificationMark origin="unjudged" />);

    const mark = screen.getByRole('img', { name: 'Not yet classified' });
    expect(mark.tagName).toBe('SPAN');
    expect(mark).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // Both mount sites need it whole: inside the ordinary row's wrapping title, and beside the
  // select-mode row's truncating one.
  it('never shrinks, at either mount site', () => {
    render(<ClassificationMark origin="claimed" />);

    expect(screen.getByRole('img', { name: 'Labelled by you' })).toHaveClass('shrink-0');
  });
});
