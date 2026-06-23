'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { PrLink, viewInRepoUrl } from '@/components/code/story-detail/pr-link';
import type { CodeStory } from '@/lib/types';

/**
 * Does the snapshot look like a full HTML document? Refinement now produces self-contained HTML
 * plans (see the refinement skill), but specs snapshotted before that are markdown — sniff the
 * head so each renders in the right mode. (`spec_markdown` is the snapshot column; it holds
 * whichever format the merged spec file was.)
 */
function looksLikeHtmlDocument(spec: string): boolean {
  const head = spec.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/** The spec body: the rendered spec — an HTML plan in an isolated frame, or legacy markdown — else a note. */
export function SpecBody({ story }: { story: CodeStory }) {
  const repoUrl = viewInRepoUrl(story);
  const spec = story.spec_markdown;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Spec
        </h3>
        {repoUrl === undefined ? null : <PrLink label="View in repo" url={repoUrl} />}
      </div>
      {spec === null || spec.trim() === '' ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          {repoUrl === undefined
            ? 'No spec yet. The refinement PR writes it when it merges.'
            : 'No spec snapshot yet — open it in the repo via the link above.'}
        </p>
      ) : looksLikeHtmlDocument(spec) ? (
        <iframe
          data-testid="spec-html"
          title="Rendered spec"
          // The spec is a committed, PR-reviewed, then snapshotted HTML plan. Render it in an
          // isolated frame so its own <style> can't leak into the app, and sandbox WITHOUT
          // allow-scripts so any <script> stays inert — we only want its static layout/CSS/SVG.
          sandbox=""
          srcDoc={spec}
          className="h-[28rem] w-full rounded-md border border-border/60 bg-white"
        />
      ) : (
        <div
          data-testid="spec-markdown"
          className="prose-spec max-w-none rounded-md border border-border/60 bg-background/40 p-4 text-sm text-foreground [&_a]:text-accent-blue [&_code]:rounded [&_code]:bg-secondary/60 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:mt-0 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-secondary/40 [&_pre]:p-2 [&_ul]:my-2"
        >
          <Markdown remarkPlugins={[remarkGfm]}>{spec}</Markdown>
        </div>
      )}
    </div>
  );
}
