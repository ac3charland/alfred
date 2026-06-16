'use client';

import { Ban, Check, ChevronLeft, ChevronRight, ExternalLink, Pencil } from 'lucide-react';
import { Dialog } from 'radix-ui';
import * as React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Spinner } from '@/components/atoms/spinner';
import { Button } from '@/components/ui/button';
import {
  HAPPY_PATH_STATES,
  STATE_LABELS,
  useCodeActions,
  useProjects,
} from '@/lib/stores/code-store';
import type { CodeFactoryState, CodeStory, Project } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Which launch phase (if any) the primary action offers in a given state. */
type LaunchPhase = 'refinement' | 'implementation';
function launchPhaseFor(state: CodeFactoryState | null): LaunchPhase | undefined {
  if (state === 'needs_refinement') return 'refinement';
  if (state === 'ready_for_dev') return 'implementation';
  return undefined;
}

const LAUNCH_LABELS: Record<LaunchPhase, { idle: string; busy: string }> = {
  refinement: { idle: 'Refine in Claude Code', busy: 'Opening refinement' },
  implementation: { idle: 'Implement in Claude Code', busy: 'Opening implementation' },
};

/** Human label for any factory state, including the escape states (which have no lane). */
function stateLabel(state: CodeFactoryState | null): string {
  if (state === 'blocked') return 'Blocked';
  if (state === 'abandoned') return 'Abandoned';
  if (state === null) return 'Unknown';
  return STATE_LABELS[state];
}

/** The happy-path neighbour one step forward / back, clamped at the ends (manual hop). */
function neighbourState(
  state: CodeFactoryState | null,
  direction: 'advance' | 'revert',
): CodeFactoryState | undefined {
  if (state === null) return undefined;
  const index = HAPPY_PATH_STATES.indexOf(state as (typeof HAPPY_PATH_STATES)[number]);
  // Off the happy path (blocked/abandoned, index -1) → no advance/revert neighbour.
  if (index === -1) return undefined;
  const nextIndex = direction === 'advance' ? index + 1 : index - 1;
  return HAPPY_PATH_STATES[nextIndex];
}

/** The View-in-repo blob URL for the recorded spec: owner/name + spec_sha + spec_path. */
function viewInRepoUrl(story: CodeStory): string | undefined {
  const { repo_owner, repo_name, spec_path } = story;
  if (repo_owner === null || repo_name === null || spec_path === null) return undefined;
  // Prefer the recorded blob sha so the link is pinned to the snapshotted spec; fall back to
  // the default branch when the sha isn't recorded yet.
  const sha = story.spec_sha ?? 'HEAD';
  return `https://github.com/${repo_owner}/${repo_name}/blob/${sha}/${spec_path}`;
}

/** The factory-state chip, tinted per happy-path / blocked / abandoned. */
function StateChip({ state }: { state: CodeFactoryState | null }) {
  return (
    <span
      data-factory-state={state ?? undefined}
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
        state === 'blocked'
          ? 'bg-amber-500/15 text-amber-400'
          : state === 'abandoned'
            ? 'bg-destructive/15 text-destructive'
            : 'bg-accent-teal/15 text-accent-teal',
      )}
    >
      {stateLabel(state)}
    </span>
  );
}

/** A PR link row (refinement / implementation), shown when the url is present. */
function PrLink({ label, url }: { label: string; url: string }) {
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

/**
 * The inline-editable title (reusing task-row's edit pattern): a double-click / pencil
 * opens an input; Enter or the check commits via `updateStoryTitle`, Escape / blur reverts.
 */
function EditableTitle({ story }: { story: CodeStory }) {
  const { updateStoryTitle } = useCodeActions();
  const currentTitle = story.title ?? '';
  const itemId = story.item_id;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(currentTitle);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const open = () => {
    setDraft(currentTitle);
    setEditing(true);
  };

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (itemId === null || next === '' || next === currentTitle) {
      setDraft(currentTitle);
      return;
    }
    try {
      await updateStoryTitle(itemId, next);
    } catch {
      // The store reverted the title; reset the draft for the next edit.
      setDraft(currentTitle);
    }
  };

  if (editing) {
    return (
      <div
        className="flex flex-1 items-center gap-2"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setDraft(currentTitle);
            setEditing(false);
          }
        }}
      >
        <input
          ref={inputRef}
          aria-label="Edit title"
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') {
              setDraft(currentTitle);
              setEditing(false);
            }
          }}
          className="flex-1 rounded-sm border border-border bg-input px-2 py-1 text-lg font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
        />
        <button
          type="button"
          aria-label="Confirm title"
          onClick={() => {
            void save();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-accent-teal bg-accent-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
        >
          <Check size={12} className="text-background" strokeWidth={3} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className="group/title flex flex-1 items-center gap-2 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
    >
      <Dialog.Title className="text-lg font-semibold text-foreground">{currentTitle}</Dialog.Title>
      <Pencil
        size={13}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 motion-reduce:transition-none"
      />
    </button>
  );
}

/**
 * The primary "Open Claude Code" action, reusing the card's await-spinner contract:
 * the modal awaits `onOpenSession` (the store's `openClaudeSession`) so the button reflects
 * the real state write. Rendered only in `needs_refinement` (refinement) / `ready_for_dev`
 * (implementation) — hidden in every other state.
 */
function PrimaryAction({
  story,
  onOpenSession,
}: {
  story: CodeStory;
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}) {
  const phase = launchPhaseFor(story.factory_state);
  const [launching, setLaunching] = React.useState(false);
  if (phase === undefined) return null;
  const labels = LAUNCH_LABELS[phase];

  const handle = async () => {
    setLaunching(true);
    try {
      await onOpenSession(story, phase);
      // On success the story moves out of the launch-eligible state; the modal usually
      // closes from the board re-render. On failure re-enable below.
    } catch {
      setLaunching(false);
    }
  };

  return (
    <Button
      size="sm"
      onClick={() => {
        void handle();
      }}
      disabled={launching}
      className="bg-accent-teal text-background hover:bg-accent-teal/90"
    >
      {launching ? <Spinner size={13} label={labels.busy} className="mr-1.5" /> : null}
      {labels.idle}
    </Button>
  );
}

/** The manual fallback controls — Block (with reason), Abandon, Advance/Revert. */
function ManualControls({ story }: { story: CodeStory }) {
  const { updateCodeState } = useCodeActions();
  const ref = story.ref;
  const state = story.factory_state;
  const [pending, setPending] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [reason, setReason] = React.useState(story.blocked_reason ?? '');

  const advanceTo = neighbourState(state, 'advance');
  const revertTo = neighbourState(state, 'revert');

  const run = async (next: CodeFactoryState, extra?: { blocked_reason?: string | null }) => {
    if (ref === null) return;
    setPending(true);
    try {
      await updateCodeState(ref, next, extra);
      setBlockOpen(false);
    } catch {
      // The store rolled the state back.
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Move this story
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending || revertTo === undefined}
          onClick={() => {
            if (revertTo !== undefined) void run(revertTo);
          }}
        >
          <ChevronLeft size={14} className="mr-1" />
          {revertTo === undefined ? 'Revert' : `Revert to ${stateLabel(revertTo)}`}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || advanceTo === undefined}
          onClick={() => {
            if (advanceTo !== undefined) void run(advanceTo);
          }}
        >
          {advanceTo === undefined ? 'Advance' : `Advance to ${stateLabel(advanceTo)}`}
          <ChevronRight size={14} className="ml-1" />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        {state === 'blocked' ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setReason(story.blocked_reason ?? '');
              setBlockOpen((on) => !on);
            }}
            className="border-amber-500/50 text-amber-400 hover:border-amber-500"
          >
            <Ban size={14} className="mr-1" />
            Block
          </Button>
        )}
        {state === 'abandoned' ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              void run('abandoned');
            }}
            className="border-destructive/50 text-destructive hover:border-destructive"
          >
            Abandon
          </Button>
        )}
      </div>

      {blockOpen ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <label htmlFor="block-reason" className="text-xs text-muted-foreground">
            Why is this blocked? (optional)
          </label>
          <textarea
            id="block-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={2}
            placeholder="e.g. waiting on an upstream API decision"
            className="w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setBlockOpen(false);
              }}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                const trimmed = reason.trim();
                void run('blocked', { blocked_reason: trimmed === '' ? null : trimmed });
              }}
              className="bg-amber-500 text-background hover:bg-amber-500/90"
            >
              Confirm block
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The spec body: rendered `spec_markdown` when present, else the repo link / a note. */
function SpecBody({ story }: { story: CodeStory }) {
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

/** The modal body — split out so it MOUNTS FRESH each open (Radix only renders while open). */
function DetailBody({
  story,
  project,
  onOpenSession,
}: {
  story: CodeStory;
  project: Project | undefined;
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}) {
  const projectName = project?.name ?? story.project_name ?? 'Project';
  const epicName = story.epic_name ?? 'Epic';
  const notes = story.notes?.trim();

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-accent-teal">{story.ref}</span>
            <StateChip state={story.factory_state} />
          </div>
          <EditableTitle story={story} />
          <p className="text-xs text-muted-foreground">
            {projectName} <span aria-hidden="true">›</span> {epicName}
          </p>
        </div>
        <Dialog.Close
          aria-label="Close"
          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ×
          </span>
        </Dialog.Close>
      </div>

      {/* The primary launch action sits in the header region. */}
      <div className="mt-4 flex items-center gap-3">
        <PrimaryAction story={story} onOpenSession={onOpenSession} />
        {story.refinement_pr_url === null ? null : (
          <PrLink label="Refinement PR" url={story.refinement_pr_url} />
        )}
        {story.implementation_pr_url === null ? null : (
          <PrLink label="Implementation PR" url={story.implementation_pr_url} />
        )}
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        {/* Notes — generic on any item. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notes
          </h3>
          {notes === undefined || notes === '' ? (
            <p className="text-sm text-muted-foreground/70">No notes.</p>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-foreground">{notes}</p>
          )}
        </div>

        <SpecBody story={story} />
      </div>

      <div className="mt-5 border-t border-border/60 pt-4">
        <ManualControls story={story} />
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
   * the modal's primary action reuses M5's await-write-then-open verbatim.
   */
  onOpenSession: (story: CodeStory, phase: LaunchPhase) => void | Promise<void>;
}

/**
 * The Jira-style story detail modal: a Radix Dialog (modelled on `cascade-modal` /
 * `gate-dialog`, sized up) opened from a board card. Shows the ref + inline-editable title,
 * the Project › Epic breadcrumb, the factory-state chip, notes, the rendered spec markdown
 * (react-markdown + remark-gfm) with a "View in repo" link, PR links, the phase-appropriate
 * "Open Claude Code" launch button, and the manual fallback controls.
 *
 * Must be mounted under a `CodeProvider` — it reads `useCodeActions` for the title edit and
 * the manual transitions. The board owns the open story + the `onOpenSession` handler.
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface p-6',
            'shadow-[0_0_40px_0_rgba(79,209,224,0.08)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
          )}
        >
          {story === null ? (
            <Dialog.Title className="sr-only">Story details</Dialog.Title>
          ) : (
            <DetailBody story={story} project={project} onOpenSession={onOpenSession} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
