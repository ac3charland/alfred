import { render } from '@testing-library/react';
import * as React from 'react';

import { ToastViewport } from '@/components/shell/toast-viewport';
import { NO_READER_HEALTH } from '@/lib/reader/fixtures';
import { ReaderProvider } from '@/lib/stores/reader-store';
import { ToastProvider } from '@/lib/stores/toast-store';
import { WikiProvider } from '@/lib/stores/wiki-store';
import type { ReaderHealthSnapshot, ReaderPostListItem } from '@/lib/types';

export interface RenderReaderOptions {
  /**
   * Whether this deployment can write into the wiki. Off by default, as on the Work instance, so
   * a test sees a send affordance only when it asks for one.
   */
  wikiWritable?: boolean;
  /** Whether the deployment can send to Instapaper. On by default, as on the Personal instance. */
  instapaperConfigured?: boolean;
}

/**
 * Render a Reader component inside `ReaderProvider` + `ToastProvider` + `WikiProvider` (mirrors
 * `renderWithProviders` in `lib/test-utils.tsx`, scoped to this module's own tests rather than
 * extending the shared cross-module helper for a store no other module reads). The wiki provider
 * sits outside the Reader's, as in the shell layout.
 */
export function renderReader(
  ui: React.ReactElement,
  initialPosts: ReaderPostListItem[] = [],
  /** Nothing read yet — the state before the tick has ever run. */
  initialHealth: ReaderHealthSnapshot = NO_READER_HEALTH,
  { wikiWritable = false, instapaperConfigured = true }: RenderReaderOptions = {},
) {
  // Via RTL's own `wrapper` option, not inlined around `ui` directly: only that way does the
  // result's `rerender` re-wrap a new element in the same providers rather than replacing the
  // whole tree (and losing the provider state) with the bare element it's given.
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ToastProvider>
        <WikiProvider
          initialPages={[]}
          initialSync={null}
          config={{ repo: wikiWritable ? 'ac3charland/knowledge' : null, writable: wikiWritable }}
        >
          <ReaderProvider
            initialPosts={initialPosts}
            initialHealth={initialHealth}
            instapaperConfigured={instapaperConfigured}
          >
            {children}
          </ReaderProvider>
        </WikiProvider>
        <ToastViewport />
      </ToastProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}
