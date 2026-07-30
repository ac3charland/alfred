'use client';

import * as React from 'react';

interface UseFormSubmitOptions<T> {
  /** The async work to run (e.g. the create/convert API call). */
  onSubmit: () => Promise<T>;
  /** Called with the result on success — typically closes the dialog / selects the row. */
  onSuccess: (result: T) => void;
  /**
   * The message shown when `onSubmit` rejects. Pass a function to read the rejection itself —
   * a refusal that already explains itself (an `ApiError`'s `detail`) is worth more to the
   * reader than a generic retry prompt.
   */
  errorMessage: string | ((error: unknown) => string);
}

interface UseFormSubmit {
  error: string | null;
  isPending: boolean;
  submit: () => Promise<void>;
}

/**
 * The shared submit flow for the code dialogs (new project / new epic / gate): clear the
 * error, mark pending, await `onSubmit`, then call `onSuccess` — or, on throw, surface
 * `errorMessage` and clear pending so the user can retry. On success `isPending` stays true:
 * the caller closes the dialog (which unmounts the form), so there's nothing left to re-enable.
 */
export function useFormSubmit<T>({
  onSubmit,
  onSuccess,
  errorMessage,
}: UseFormSubmitOptions<T>): UseFormSubmit {
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  const submit = React.useCallback(async () => {
    setError(null);
    setIsPending(true);
    try {
      const result = await onSubmit();
      onSuccess(result);
    } catch (error_) {
      setError(typeof errorMessage === 'string' ? errorMessage : errorMessage(error_));
      setIsPending(false);
    }
  }, [onSubmit, onSuccess, errorMessage]);

  return { error, isPending, submit };
}
