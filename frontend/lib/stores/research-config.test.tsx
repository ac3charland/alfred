import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { ResearchConfigProvider, useResearchConfigured } from './research-config';

function Probe() {
  return <p>{useResearchConfigured() ? 'configured' : 'not configured'}</p>;
}

describe('useResearchConfigured', () => {
  it.each([
    [true, 'configured'],
    [false, 'not configured'],
  ])('reads configured=%s from the provider', (configured, text) => {
    render(
      <ResearchConfigProvider configured={configured}>
        <Probe />
      </ResearchConfigProvider>,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('throws outside the provider, so a harness that forgets it fails loudly', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(
      'useResearchConfigured must be used within a ResearchConfigProvider',
    );
  });
});
