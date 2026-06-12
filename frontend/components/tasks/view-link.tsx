'use client';

import * as React from 'react';

type ViewLinkProperties = React.ComponentPropsWithoutRef<'a'> & {
  /** The destination path, e.g. `/folders/abc` or `/?view=inbox`. */
  href: string;
};

/**
 * An anchor that switches between task views client-side instead of doing a full RSC
 * navigation. Every view already renders from the seeded stores, so there is nothing
 * to fetch — Next.js patches `window.history.pushState` to sync `usePathname` /
 * `useSearchParams`, so the URL (and every URL-deriving view, e.g. TaskViews) updates
 * with no server round-trip.
 *
 * It stays a real `<a href>`: modified clicks (new tab/window), middle-clicks, and a
 * hard load of the href all fall back to native navigation, and keyboard users still
 * get a proper link. Only a plain primary click is intercepted.
 */
export function ViewLink({ href, onClick, children, ...rest }: ViewLinkProperties) {
  const handleClick = (event_: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event_);
    // Let the browser handle anything that isn't a plain primary click: a consumer
    // that already prevented default, a non-left button, or a modifier (open in a
    // new tab/window).
    if (
      event_.defaultPrevented ||
      event_.button !== 0 ||
      event_.metaKey ||
      event_.ctrlKey ||
      event_.shiftKey ||
      event_.altKey
    ) {
      return;
    }
    event_.preventDefault();
    globalThis.history.pushState(null, '', href);
  };

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
