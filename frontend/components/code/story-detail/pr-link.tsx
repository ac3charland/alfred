import { ExternalLink } from 'lucide-react';
import type * as React from 'react';

import { specBlobUrl } from '@/lib/code/links';
import type { CodeStory } from '@/lib/types';

/**
 * The View-in-repo blob URL for a STORY's recorded spec. The URL rule itself is shared with the
 * epic spec modal (`specBlobUrl`); this only sources the coordinates from a joined view row.
 */
export function viewInRepoUrl(story: CodeStory): string | undefined {
  return specBlobUrl({
    repoOwner: story.repo_owner,
    repoName: story.repo_name,
    specPath: story.spec_path,
    specSha: story.spec_sha,
  });
}

/**
 * The external-link treatment every story-detail link shares — accent-blue text after an
 * ExternalLink icon, opening in a new tab — so a session link reads as the same kind of thing as a
 * PR link. `children` is the link's text (and so its accessible name).
 */
export function ExternalAnchor({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-accent-blue hover:text-accent-blue/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      <ExternalLink size={13} className="shrink-0" />
      {children}
    </a>
  );
}

/** A PR / repo link row (refinement / implementation / View in repo), shown when present. */
export function PrLink({ label, url }: { label: string; url: string }) {
  return <ExternalAnchor href={url}>{label}</ExternalAnchor>;
}
