import { ExternalLink } from 'lucide-react';

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

/** A PR / repo link row (refinement / implementation / View in repo), shown when present. */
export function PrLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-accent-blue hover:text-accent-blue/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      <ExternalLink size={13} className="shrink-0" />
      {label}
    </a>
  );
}
