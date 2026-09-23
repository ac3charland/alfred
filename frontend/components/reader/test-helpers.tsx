import { render } from '@testing-library/react';
import * as React from 'react';

import { ToastViewport } from '@/components/shell/toast-viewport';
import { NO_READER_HEALTH } from '@/lib/reader/fixtures';
import { ReaderProvider } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderHealthSnapshot, ReaderPostListItem } from '@/lib/types';

/**
 * Render a Reader component inside `ReaderProvider` + `ToastProvider` (mirrors
 * `renderWithProviders` in `lib/test-utils.tsx`, scoped to this module's own tests rather than
 * extending the shared cross-module helper for a store no other module reads).
 */
export function renderReader(
  ui: React.ReactElement,
  initialPosts: ReaderPostListItem[] = [],
  /** Nothing read yet — the state before the tick has ever run. */
  initialHealth: ReaderHealthSnapshot = NO_READER_HEALTH,
) {
  // Via RTL's own `wrapper` option, not inlined around `ui` directly: only that way does the
  // result's `rerender` re-wrap a new element in the same providers rather than replacing the
  // whole tree (and losing the provider state) with the bare element it's given.
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ToastProvider>
        <ReaderProvider initialPosts={initialPosts} initialHealth={initialHealth}>
          {children}
        </ReaderProvider>
        <ToastViewport />
      </ToastProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}
