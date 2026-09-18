import { screen } from '@testing-library/react';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';

import { ShellNav } from './shell-nav';

const mockPathname = jest.fn<string, []>(() => '/');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: jest.fn() }),
}));

describe('ShellNav', () => {
  it('renders FolderNav on a Tasks route', () => {
    mockPathname.mockReturnValue('/priority');
    renderWithProviders(<ShellNav />);

    expect(screen.getByRole('navigation', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('renders ProjectNav on a Code route', () => {
    mockPathname.mockReturnValue('/code');
    renderWithProviders(<ShellNav />);

    expect(screen.getByRole('navigation', { name: 'Projects' })).toBeInTheDocument();
  });

  it('renders CommsNav on a Comms route', () => {
    mockPathname.mockReturnValue('/comms');
    renderWithProviders(<ShellNav />);

    expect(screen.getByRole('navigation', { name: 'Comms' })).toBeInTheDocument();
  });

  it('renders ReaderNav on a Reader route', () => {
    mockPathname.mockReturnValue('/reader');
    renderWithProviders(<ShellNav />);

    expect(screen.getByRole('navigation', { name: 'Reader' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reading list' })).toHaveAttribute('href', '/reader');
  });
});
