'use client';

import { ChevronRight, FileText } from 'lucide-react';
import * as React from 'react';

import { ClickableCard } from '@/components/atoms/clickable-card';
import { FullScreenDialog } from '@/components/atoms/dialog';
import { SpecDocument, SpecHeading, SpecView } from '@/components/code/spec-view';
import { SECTION_HEADING_CLASS } from '@/components/code/story-detail/layout';
import { viewInRepoUrl } from '@/components/code/story-detail/pr-link';
import { KIND_DOCUMENT } from '@/components/code/story-detail/spec-body';
import { specTitle } from '@/lib/code/spec-title';
import { storyKindOf } from '@/lib/code/story-kind';
import type { CodeStory } from '@/lib/types';

/**
 * The phone sheet's version of the spec section: a document row that opens the spec in a
 * full-screen reader, instead of the spec itself. A rendered HTML spec is a white 28rem frame,
 * which is cramped inside a phone sheet and looks like the editable notes above it; a row differs
 * by shape as well as heading, and the reader gives the document the whole screen.
 *
 * The row is titled from the document (its `<title>`, first `#` line, or file name). With no
 * snapshot yet there is nothing to open, so the section shows the same empty-state copy the
 * desktop does. A spike's document reads **Findings**.
 */
export function SpecRow({ story }: { story: CodeStory }) {
  const { heading, emptyCopy } = KIND_DOCUMENT[storyKindOf(story)];
  const repoUrl = viewInRepoUrl(story);
  const [open, setOpen] = React.useState(false);
  const row = React.useRef<HTMLButtonElement>(null);
  const spec = story.spec_markdown;

  if (spec === null || spec.trim() === '') {
    return (
      <SpecView
        spec={null}
        repoUrl={repoUrl}
        heading={heading}
        emptyCopy={emptyCopy}
        headingClassName={SECTION_HEADING_CLASS.sheet}
      />
    );
  }

  const title = specTitle(spec, story.spec_path, heading);

  return (
    <div className="flex flex-col gap-2">
      <SpecHeading heading={heading} repoUrl={repoUrl} className={SECTION_HEADING_CLASS.sheet} />
      <ClickableCard
        ref={row}
        onClick={() => {
          setOpen(true);
        }}
        className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 focus-visible:ring-2 focus-visible:ring-accent-teal"
      >
        <FileText size={18} className="shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">Tap to read full-screen</span>
        </span>
        <ChevronRight size={14} className="ml-auto shrink-0 text-muted-foreground" />
      </ClickableCard>
      <FullScreenDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        // Safari doesn't focus a button when it is tapped, so the reader has nothing to hand focus
        // back to on its own: return it to the row explicitly.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          row.current?.focus();
        }}
      >
        <SpecDocument spec={spec} heading={heading} fill />
      </FullScreenDialog>
    </div>
  );
}
