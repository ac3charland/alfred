import { render, screen } from '@testing-library/react';

import { ActiveModuleLabel } from './active-module-label';

// Same route table as `lib/modules.test.ts`'s `activeModule` suite — this component is a thin
// render of that same derivation, so it must agree with it route for route.
const mockPathname = jest.fn<string, []>(() => '/');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

describe('ActiveModuleLabel', () => {
  it('names Tasks on the root and other Tasks routes', () => {
    mockPathname.mockReturnValue('/priority');
    render(<ActiveModuleLabel />);
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });

  it('names Code on a Code route', () => {
    mockPathname.mockReturnValue('/code/abc-123');
    render(<ActiveModuleLabel />);
    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('names Comms on a Comms route', () => {
    mockPathname.mockReturnValue('/comms/people');
    render(<ActiveModuleLabel />);
    expect(screen.getByText('Comms')).toBeInTheDocument();
  });

  it('names Reader on a Reader route', () => {
    mockPathname.mockReturnValue('/reader/archive');
    render(<ActiveModuleLabel />);
    expect(screen.getByText('Reader')).toBeInTheDocument();
  });

  it('names Wiki on a Wiki route', () => {
    mockPathname.mockReturnValue('/wiki/concepts/habit-stacking');
    render(<ActiveModuleLabel />);
    expect(screen.getByText('Wiki')).toBeInTheDocument();
  });

  it("wears the active module's own accent colour, matching the switcher's highlight", () => {
    mockPathname.mockReturnValue('/code');
    render(<ActiveModuleLabel />);
    expect(screen.getByText('Code')).toHaveClass('text-accent-teal');
  });

  it('is plain text, not a link — the wordmark keeps the only navigation in this row', () => {
    mockPathname.mockReturnValue('/wiki');
    render(<ActiveModuleLabel />);
    expect(screen.queryByRole('link', { name: 'Wiki' })).not.toBeInTheDocument();
  });
});
