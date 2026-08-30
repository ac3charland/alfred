'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { PrLink } from '@/components/code/story-detail/pr-link';
// Refinement now produces self-contained HTML plans (see the refinement skill), but specs
// snapshotted before that are markdown — sniff the head so each renders in the right mode.
// (`spec_markdown` is the snapshot column; it holds whichever format the merged spec file was.)
import { looksLikeHtmlDocument } from '@/lib/html-document';

export interface SpecViewProperties {
  /** The snapshotted spec body (HTML or markdown), or `null` when nothing is snapshotted yet. */
  spec: string | null;
  /** The sha-pinned "View in repo" link, or `undefined` when there is no recorded spec path. */
  repoUrl: string | undefined;
  /**
   * What to say when there is no spec at all. The wording names the subject ("No spec yet…" vs
   * "No epic spec yet…") and the action that writes one, so it stays with the caller.
   */
  emptyCopy: string;
  /**
   * What the document IS, as the section eyebrow — and the noun the "recorded but not
   * snapshotted" line uses, so both read of the same subject. Defaults to `Spec`; a spike's
   * story renders the same view under `Findings`.
   */
  heading?: string;
}

/**
 * The rendered spec — an HTML plan in an isolated frame, legacy markdown as prose, else an
 * empty-state note — with a "View in repo" link when the spec's path is recorded. Presentational
 * and subject-free: the story detail modal, the epic spec modal and a spike's findings all render
 * through this, each deriving `spec`/`repoUrl` and its own `heading`/`emptyCopy` from its row.
 */
export function SpecView({ spec, repoUrl, emptyCopy, heading = 'Spec' }: SpecViewProperties) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {heading}
        </h3>
        {repoUrl === undefined ? null : <PrLink label="View in repo" url={repoUrl} />}
      </div>
      {spec === null || spec.trim() === '' ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          {repoUrl === undefined
            ? emptyCopy
            : `No ${heading.toLowerCase()} snapshot yet — open it in the repo via the link above.`}
        </p>
      ) : looksLikeHtmlDocument(spec) ? (
        <iframe
          data-testid="spec-html"
          title={`Rendered ${heading.toLowerCase()}`}
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
