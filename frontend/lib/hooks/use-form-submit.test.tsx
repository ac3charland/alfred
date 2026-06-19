import { act, renderHook, waitFor } from '@testing-library/react';

import { useFormSubmit } from './use-form-submit';

describe('useFormSubmit', () => {
  it('starts not pending with no error', () => {
    const { result } = renderHook(() =>
      useFormSubmit({
        onSubmit: () => Promise.resolve('ok'),
        onSuccess: jest.fn(),
        errorMessage: 'failed',
      }),
    );
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('calls onSuccess with the result on success (and leaves pending true)', async () => {
    const onSuccess = jest.fn();
    const { result } = renderHook(() =>
      useFormSubmit({
        onSubmit: () => Promise.resolve({ id: '1' }),
        onSuccess,
        errorMessage: 'failed',
      }),
    );

    await act(async () => {
      await result.current.submit();
    });

    expect(onSuccess).toHaveBeenCalledWith({ id: '1' });
    expect(result.current.error).toBeNull();
    // The caller closes the dialog on success, so the hook does not re-enable.
    expect(result.current.isPending).toBe(true);
  });

  it('sets the error message and clears pending on failure', async () => {
    const onSuccess = jest.fn();
    const { result } = renderHook(() =>
      useFormSubmit({
        onSubmit: () => Promise.reject(new Error('boom')),
        onSuccess,
        errorMessage: 'Could not save. Try again.',
      }),
    );

    await act(async () => {
      await result.current.submit();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Could not save. Try again.');
    expect(result.current.isPending).toBe(false);
  });

  it('clears a prior error when re-submitting', async () => {
    let shouldFail = true;
    const { result } = renderHook(() =>
      useFormSubmit({
        onSubmit: () => (shouldFail ? Promise.reject(new Error('x')) : Promise.resolve('ok')),
        onSuccess: jest.fn(),
        errorMessage: 'failed',
      }),
    );

    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).toBe('failed');

    shouldFail = false;
    await act(async () => {
      await result.current.submit();
    });
    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
  });
});
