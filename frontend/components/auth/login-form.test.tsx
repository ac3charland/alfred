import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { LoginForm } from './login-form';

// Mock next/navigation so router calls don't throw in jsdom.
const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter() {
    return { push: mockPush, refresh: mockRefresh };
  },
}));

// Mock the browser Supabase client so tests never hit the network.
const mockSignInWithPassword = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient() {
    return {
      auth: {
        signInWithPassword: mockSignInWithPassword,
      },
    };
  },
}));

describe('LoginForm', () => {
  it('renders email and password fields plus a submit button', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls signInWithPassword with the entered credentials on submit', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: undefined });

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'owner@example.com');
    await user.type(screen.getByLabelText(/password/i), 'supersecret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'owner@example.com',
        password: 'supersecret',
      });
    });
  });

  it('refreshes and redirects to / on successful sign-in', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: undefined });

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'owner@example.com');
    await user.type(screen.getByLabelText(/password/i), 'supersecret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('shows the error message on sign-in failure', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    });

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'owner@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid login credentials/i);
    // Should NOT navigate away.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not show an alert when there is no error', () => {
    render(<LoginForm />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables inputs and button while sign-in is pending', async () => {
    // Never resolves so the component stays in isPending=true state
    mockSignInWithPassword.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'owner@example.com');
    await user.type(screen.getByLabelText(/password/i), 'supersecret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByLabelText(/email/i)).toBeDisabled();
    expect(screen.getByLabelText(/password/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
  });

  it('re-enables the button after a failed sign-in', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    });

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'owner@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // After the async failure completes, the button should be re-enabled
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
  });

  it('re-enables the button after a successful sign-in', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: undefined });

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'owner@example.com');
    await user.type(screen.getByLabelText(/password/i), 'supersecret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
  });
});
