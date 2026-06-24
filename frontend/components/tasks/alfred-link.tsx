'use client';

import * as React from 'react';

import { ViewLink } from '@/components/tasks/view-link';

export const ALFRED_CAPTURE_FOCUS_EVENT = 'alfred-capture-focus';

/**
 * Dispatched (with `{ detail: { id } }`) when a global-search result for a task is selected,
 * after the client-side view switch. The task list/row that owns the matching id scrolls it
 * into view and applies a brief highlight — see `useFocusItemHighlight`.
 */
export const ALFRED_FOCUS_ITEM_EVENT = 'alfred-focus-item';

type AlfredLinkProperties = Omit<React.ComponentPropsWithoutRef<'a'>, 'href'>;

/**
 * The alfred wordmark link. Navigates to `/` (capture screen) and signals
 * the capture box to focus so the user can start typing immediately.
 */
export function AlfredLink({ onClick, children, ...rest }: AlfredLinkProperties) {
  const handleClick = (event_: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event_);
    if (
      !event_.defaultPrevented &&
      event_.button === 0 &&
      !event_.metaKey &&
      !event_.ctrlKey &&
      !event_.shiftKey &&
      !event_.altKey
    ) {
      globalThis.dispatchEvent(new CustomEvent(ALFRED_CAPTURE_FOCUS_EVENT));
    }
  };

  return (
    <ViewLink href="/" onClick={handleClick} {...rest}>
      {children}
    </ViewLink>
  );
}
