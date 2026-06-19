import { ExternalLink } from 'lucide-react';

import type { CodeStory } from '@/lib/types';

/** The View-in-repo blob URL for the recorded spec: owner/name + spec_sha + spec_path. */
export function viewInRepoUrl(story: CodeStory): string | undefined {
  const { repo_owner, repo_name, spec_path } = story;
  if (repo_owner === null || repo_name === null || spec_path === null) return undefined;
  // Prefer the recorded blob sha so the link is pinned to the snapshotted spec; fall back to
  // the default branch when the sha isn't recorded yet.
  const sha = story.spec_sha ?? 'HEAD';
  return `https://github.com/${repo_owner}/${repo_name}/blob/${sha}/${spec_path}`;
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
