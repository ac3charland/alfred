import { render } from '@testing-library/react';
import * as React from 'react';

import { ToastViewport } from '@/components/shell/toast-viewport';
import { ReaderProvider } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import type { ReaderPostListItem } from '@/lib/types';

/**
 * Render a Reader component inside `ReaderProvider` + `ToastProvider` (mirrors
 * `renderWithProviders` in `lib/test-utils.tsx`, scoped to this module's own tests rather than
 * extending the shared cross-module helper for a store no other module reads).
 */
export function renderReader(ui: React.ReactElement, initialPosts: ReaderPostListItem[] = []) {
  return render(
    <ToastProvider>
      <ReaderProvider initialPosts={initialPosts}>{ui}</ReaderProvider>
      <ToastViewport />
    </ToastProvider>,
  );
}
