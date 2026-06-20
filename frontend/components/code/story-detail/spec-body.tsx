'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { PrLink, viewInRepoUrl } from '@/components/code/story-detail/pr-link';
import type { CodeStory } from '@/lib/types';

/** The spec body: rendered `spec_markdown` when present, else the repo link / a note. */
export function SpecBody({ story }: { story: CodeStory }) {
  const repoUrl = viewInRepoUrl(story);
  const hasSpec = story.spec_markdown !== null && story.spec_markdown.trim() !== '';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Spec
        </h3>
        {repoUrl === undefined ? null : <PrLink label="View in repo" url={repoUrl} />}
      </div>
      {hasSpec ? (
        <div
          data-testid="spec-markdown"
          className="prose-spec max-w-none rounded-md border border-border/60 bg-background/40 p-4 text-sm text-foreground [&_a]:text-accent-blue [&_code]:rounded [&_code]:bg-secondary/60 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:mt-0 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-secondary/40 [&_pre]:p-2 [&_ul]:my-2"
        >
          <Markdown remarkPlugins={[remarkGfm]}>{story.spec_markdown}</Markdown>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          {repoUrl === undefined
            ? 'No spec yet. The refinement PR writes it when it merges.'
            : 'No spec snapshot yet — open it in the repo via the link above.'}
        </p>
      )}
    </div>
  );
}
