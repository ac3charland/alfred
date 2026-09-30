'use client';

import { ChevronDown, Pencil } from 'lucide-react';
import * as React from 'react';

import {
  DialogCloseButton,
  DialogTitle,
  FormDialog,
  SheetDialog,
  SheetFooter,
  useSheetFooterElement,
} from '@/components/atoms/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { EditableTextField } from '@/components/atoms/editable-text-field';
import { StoryRef } from '@/components/atoms/story-ref';
import { StateChip } from '@/components/code/state-chip';
import { ActionBar } from '@/components/code/story-detail/action-bar';
import { EditableNotes } from '@/components/code/story-detail/editable-notes';
import { type DetailLayout, SECTION_HEADING_CLASS } from '@/components/code/story-detail/layout';
import {
  BlockReasonEditor,
  ManualControls,
  useStoryTransitions,
} from '@/components/code/story-detail/manual-controls';
import { PrLink } from '@/components/code/story-detail/pr-link';
import { PrimaryAction } from '@/components/code/story-detail/primary-action';
import { PriorityControls } from '@/components/code/story-detail/priority-controls';
import { RefinementMark } from '@/components/code/story-detail/refinement-mark';
import { SpecBody } from '@/components/code/story-detail/spec-body';
import { SpecRow } from '@/components/code/story-detail/spec-row';
import { StoryKindBadge } from '@/components/code/story-kind-badge';
import type { LaunchPhase } from '@/lib/code/launch';
import { type ProjectColor, projectColorFor } from '@/lib/code/project-color';
import { type StoryKind, storyKindOf } from '@/lib/code/story-kind';
import { MOBILE_QUERY, useMediaQuery } from '@/lib/hooks/use-media-query';
import { useCodeActions, useEpics, useProjects } from '@/lib/stores/code-store';
import type { CodeStory, Project } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The inline-editable title (reusing task-row's edit pattern): a double-click / pencil
 * opens an input; Enter or the check commits via `updateStoryTitle`, Escape / blur reverts.
 */
function EditableTitle({
  story,
  className = 'text-lg',
}: {
  story: CodeStory;
  /** The title's size: `text-lg` on the card, a step up on the phone sheet. */
  className?: string;
}) {
  const { updateStoryTitle } = useCodeActions();
  const currentTitle = story.title ?? '';
  const itemId = story.item_id;

  return (
    <EditableTextField
      value={currentTitle}
      onSave={async (next) => {
        // A view row may have a null item_id; nothing to PATCH then.
        if (itemId === null) return;
        await updateStoryTitle(itemId, next);
      }}
      label="Edit title"
      inputClassName={cn(className, 'font-semibold')}
      selectAllOnEdit={false}
    >
      <DialogTitle className={cn(className, 'font-semibold text-foreground')}>
        {currentTitle}
      </DialogTitle>
      <Pencil
        size={13}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/editable:opacity-100 motion-reduce:transition-none"
      />
    </EditableTextField>
  );
}

/**
 * The **Epic** half of the `Project › Epic` breadcrumb, turned into a move-the-story
 * dropdown. Lists the project's other, non-archived epics (current excluded, archived
 * excluded, other projects' excluded), oldest-first (board order); selecting one calls the
 * store's optimistic `moveStoryToEpic`, which re-homes the card and updates this breadcrumb
 * live. A single-epic project has no candidates, so the epic renders as plain text.
 */
function EpicBreadcrumb({ story }: { story: CodeStory }) {
  const { moveStoryToEpic } = useCodeActions();
  const epics = useEpics();
  const epicName = story.epic_name ?? 'Epic';

  // The store's epics slice is seeded in board order (oldest-first), and filter preserves it.
  const candidates = epics.filter(
    (epic) =>
      epic.project_id === story.project_id &&
      epic.id !== story.epic_id &&
      epic.archived_at === null,
  );

  // Guard a null ref exactly as the title/manual controls do (the view row type is
  // all-nullable). The store rolls back on rejection and the modal re-reads the live row, so
  // there's nothing extra to undo here.
  const move = async (epicId: string) => {
    if (story.ref === null || story.item_id === null) return;
    try {
      await moveStoryToEpic(story.ref, epicId);
    } catch {
      // The store rolled the move back.
    }
  };

  // No other active epic to move to → no dead dropdown; render the epic as plain text
  // (a span so it inherits the breadcrumb's muted style, exactly as the old static text did).
  if (candidates.length === 0) {
    return <span>{epicName}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Change epic"
        className="group/epic inline-flex items-center gap-0.5 rounded-sm text-foreground hover:text-accent-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
      >
        {epicName}
        <ChevronDown
          size={12}
          className="shrink-0 text-muted-foreground transition-colors group-hover/epic:text-accent-teal motion-reduce:transition-none"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {candidates.map((epic) => (
          <DropdownMenuItem
            key={epic.id}
            onSelect={() => {
              void move(epic.id);
            }}
          >
            <span className="text-foreground">{epic.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{epic.ref}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The modal body — split out so it MOUNTS FRESH each open (Radix only renders while open). */
/**
 * What the `implementation_pr_url` column holds for each kind — the same column, three different
 * things: the PR that builds the spec, the one that writes the findings, the one that fixes the
 * defect. Labelling it by kind keeps the link honest about which it is.
 */
const IMPLEMENTATION_PR_LABELS: Record<StoryKind, string> = {
  story: 'Implementation PR',
  spike: 'Spike PR',
  bug: 'Fix PR',
};

function DetailBody({
  story,
  project,
  projectColor,
  onOpenSession,
  layout,
}: {
  story: CodeStory;
  project: Project | undefined;
  projectColor: ProjectColor;
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
  layout: DetailLayout;
}) {
  const projectName = project?.name ?? story.project_name ?? 'Project';
  // Neither a spike nor a bug is ever refined: each runs as one session, so a "Needs refinement"
  // toggle would promise a phase that never runs — the control is absent rather than disabled.
  const kind = storyKindOf(story);
  // The block-reason editor's open state lives here, not in the manual controls: on a phone the
  // ⋯ menu's Block… opens a card at the end of the body, nowhere near its button.
  const [blockOpen, setBlockOpen] = React.useState(false);
  const transitions = useStoryTransitions(story, () => {
    setBlockOpen(false);
  });
  const footer = useSheetFooterElement();

  const breadcrumb = (
    <p className="text-xs text-muted-foreground">
      {projectName} <span aria-hidden="true">›</span> <EpicBreadcrumb story={story} />
    </p>
  );
  const prLinks = (
    <>
      {story.refinement_pr_url === null ? null : (
        <PrLink label="Refinement PR" url={story.refinement_pr_url} />
      )}
      {story.implementation_pr_url === null ? null : (
        <PrLink label={IMPLEMENTATION_PR_LABELS[kind]} url={story.implementation_pr_url} />
      )}
    </>
  );

  if (layout === 'sheet') {
    return (
      <>
        {/* Pinned: the ref, state and × stay put while the body scrolls. The title scrolls. */}
        <div
          data-sheet-header=""
          // The divider is an inset shadow, not `border-b`: a border would take a pixel from the
          // row's 44px and leave the × (a 44px tap target) overflowing it.
          className="flex h-11 shrink-0 items-center gap-2 pl-4 pr-1 shadow-[inset_0_-1px_0_var(--color-border)]"
        >
          <StoryRef color={projectColor} className="text-sm">
            {story.ref}
          </StoryRef>
          <StateChip state={story.factory_state} />
          <StoryKindBadge story={story} />
          <div className="ml-auto">
            <DialogCloseButton />
          </div>
        </div>

        <div data-sheet-body="" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
          <div className="flex flex-col gap-1.5">
            <EditableTitle story={story} className="text-xl" />
            {breadcrumb}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{prLinks}</div>

          <div className="mt-6 flex flex-col gap-2">
            <h3 className={SECTION_HEADING_CLASS.sheet}>Notes</h3>
            <EditableNotes
              story={story}
              layout="sheet"
              onStartEditing={() => {
                // One editor at a time: the notes editor takes the footer from the block reason.
                setBlockOpen(false);
              }}
            />
          </div>

          <div className="mt-6">
            <SpecRow story={story} />
          </div>

          {blockOpen ? (
            <div className="mt-6">
              <BlockReasonEditor
                story={story}
                pending={transitions.pending}
                onConfirm={transitions.confirmBlock}
                onCancel={() => {
                  setBlockOpen(false);
                }}
                autoGrow
                actionsTarget={footer}
                reveal
              />
            </div>
          ) : null}
        </div>

        <SheetFooter>
          <ActionBar
            story={story}
            transitions={transitions}
            onBlock={() => {
              setBlockOpen(true);
            }}
            onOpenSession={onOpenSession}
          />
        </SheetFooter>
      </>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <StoryRef color={projectColor} className="text-sm">
              {story.ref}
            </StoryRef>
            <StateChip state={story.factory_state} />
            <StoryKindBadge story={story} />
          </div>
          <EditableTitle story={story} />
          {breadcrumb}
        </div>
        <DialogCloseButton />
      </div>

      {/* The primary launch action sits in the header region, alongside the PR links and the
          refinement mark — the property that decides whether this story ever needs a spec. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <PrimaryAction story={story} onOpenSession={onOpenSession} />
        {prLinks}
        {kind === 'story' ? <RefinementMark story={story} /> : null}
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        {/* Notes — generic on any item, inline-editable via updateStoryNotes. */}
        <div className="flex flex-col gap-2">
          <h3 className={SECTION_HEADING_CLASS.dialog}>Notes</h3>
          <EditableNotes story={story} layout="dialog" />
        </div>

        <SpecBody story={story} />
      </div>

      <div className="mt-5 flex flex-col gap-5 border-t border-border/60 pt-4">
        <PriorityControls story={story} />
        <ManualControls
          story={story}
          transitions={transitions}
          blockOpen={blockOpen}
          onBlockOpenChange={setBlockOpen}
        />
      </div>
    </>
  );
}

export interface StoryDetailModalProperties {
  /** The story to show; `null` keeps the modal closed (it opens when a card is clicked). */
  story: CodeStory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The human-launch handler the board threads in (the store's `openClaudeSession`), so
   * the modal's primary action reuses the await-write-then-open launch verbatim.
   */
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}

/**
 * The Jira-style story detail modal: a Radix Dialog (modelled on `cascade-modal` /
 * `gate-dialog`, sized up) opened from a board card. Shows the ref + inline-editable title,
 * the Project › Epic breadcrumb, the factory-state chip, notes, the rendered spec (an HTML
 * plan in an isolated frame, or legacy markdown) with a "View in repo" link, PR links, the phase-appropriate
 * "Open Claude Code" launch button, the "Needs refinement" mark, the Backlog priority jumps, and
 * the manual fallback controls.
 *
 * Must be mounted under a `CodeProvider` — it reads `useCodeActions` for the title edit, the
 * move-to-epic dropdown, the priority jumps, and the manual transitions, and `useEpics` for the
 * dropdown's candidates. The board owns the open story + the `onOpenSession` handler. The
 * header chip, primary action, spec body, priority controls, and manual controls are their own
 * sub-components under `code/story-detail/`; this file is the composition root.
 */
export function StoryDetailModal({
  story,
  open,
  onOpenChange,
  onOpenSession,
}: StoryDetailModalProperties) {
  const projects = useProjects();
  // Resolve the project from the store for the breadcrumb (the view row also carries a name,
  // used as the fallback). Read it here so the body stays a pure function of its props.
  const project = story === null ? undefined : projects.find((p) => p.id === story.project_id);

  // A phone gets the full-screen sheet; anything wider, the centred card. Decided in JS rather
  // than with `max-md:` classes because the two layouts are different DOM (menus vs buttons) —
  // hidden duplicates would double every accessible control. The modal only ever opens on the
  // client, so the server snapshot never flashes the wrong layout.
  const isPhone = useMediaQuery(MOBILE_QUERY);
  const layout: DetailLayout = isPhone ? 'sheet' : 'dialog';
  const body =
    story === null ? (
      <DialogTitle className="sr-only">Story details</DialogTitle>
    ) : (
      <DetailBody
        story={story}
        project={project}
        projectColor={projectColorFor(projects, story.project_id)}
        onOpenSession={onOpenSession}
        layout={layout}
      />
    );

  // The card reuses FormDialog (the shared Root → Portal → DialogOverlay → Content scaffold),
  // sized to `2xl` with the scrollable flex body — same shell as gate-dialog. `aria-describedby`
  // is suppressed (no Description element); the Close button + Title live in DetailBody.
  if (isPhone) {
    return (
      <SheetDialog open={open} onOpenChange={onOpenChange} aria-describedby={undefined}>
        {body}
      </SheetDialog>
    );
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="2xl"
      className="flex max-h-[85vh] flex-col"
      aria-describedby={undefined}
    >
      {body}
    </FormDialog>
  );
}
