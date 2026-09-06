'use client';

import { FolderOpen, GitBranch, Repeat } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { Chip } from '@/components/atoms/chip';
import { PickerChip } from '@/components/atoms/picker-chip';
import { RecurrenceEditor } from '@/components/tasks/recurrence/recurrence-editor';
import { projectBadgeClasses, projectChipClasses, projectColorFor } from '@/lib/code/project-color';
import { todayISODate } from '@/lib/date-utils';
import {
  REPEAT_PRESETS,
  type RecurrencePreset,
  type RecurrenceRule,
  presetForRule,
  ruleFromPreset,
  summarizeRule,
} from '@/lib/recurrence';
import { useEpics, useProjects } from '@/lib/stores/code-store';
import { useFolders } from '@/lib/stores/folders-store';
import { epicOptions, folderOptions, projectOptions } from '@/lib/tasks/label-options';
import { cn } from '@/lib/utils';

/** The neutral (unset) chip tone — slate text on a faint slate border. */
const chipNeutral = 'border-[#25324a] text-[#8A96A8] hover:border-[#34415a]';

/** The teal "set" chip tone — for a value that owns no colour of its own (Repeat, Folder). */
const chipTeal = 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal';

interface RepeatChipProperties {
  /** The current recurrence rule, or null when the task doesn't repeat. */
  rule: RecurrenceRule | null;
  /** The task's due date (the recurrence anchor); falls back to today when absent. */
  dueDate: string | null;
  /** Persist a rule (or null to clear); `anchorDate` becomes the due date when the task has none. */
  onChange: (rule: RecurrenceRule | null, anchorDate: string) => void;
}

/**
 * The **Repeat** detail chip: a repeat icon + the rule summary, teal when repeating and neutral
 * slate on "Never". Opens the shared {@link PickerChip} preset list plus a "Custom…" entry that
 * opens the full {@link RecurrenceEditor}. A pick applies immediately.
 */
export function RepeatChip({ rule, dueDate, onChange }: RepeatChipProperties) {
  const [editorOpen, setEditorOpen] = React.useState(false);
  const anchorDate = dueDate ?? todayISODate();
  const activePreset = rule === null ? 'never' : presetForRule(rule);

  return (
    <>
      <PickerChip
        trigger={
          <Chip aria-label="Repeat" className={cn(rule === null ? chipNeutral : chipTeal)}>
            <Repeat size={13} strokeWidth={2.2} className="shrink-0" />
            {rule === null ? 'Never' : summarizeRule(rule)}
          </Chip>
        }
        value={activePreset}
        options={[
          ...REPEAT_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
          { value: 'custom', label: 'Custom…' },
        ]}
        onSelect={(value) => {
          if (value === 'custom') {
            setEditorOpen(true);
            return;
          }
          // The preset list's values are the non-null preset ids; a null can't arrive here.
          if (value === null) return;
          onChange(ruleFromPreset(value as RecurrencePreset, anchorDate), anchorDate);
        }}
      />

      {editorOpen && (
        <RecurrenceEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          initialRule={rule}
          anchorDate={anchorDate}
          onSave={(next) => {
            onChange(next, anchorDate);
          }}
        />
      )}
    </>
  );
}

interface FolderChipProperties {
  /** The folder the row would land in (`folder_id`), or null when unlabelled. */
  folderId: string | null;
  /**
   * Offer the "No folder" clear entry. Only while the row is undispatched — a dispatched task
   * must keep a folder (the DB CHECK), so un-filing stays the row menu's "Move to… → Inbox".
   */
  allowClear: boolean;
  /** A pick auto-saves (`setFolder` — labels without moving; see the tasks store). */
  onSelect: (folderId: string | null) => void;
  /**
   * `compact` — the row chip (the muted badge tone the row's other pills wear). `comfortable` —
   * the detail-panel chip (teal when set, neutral when not). Defaults to `comfortable`.
   */
  size?: 'compact' | 'comfortable';
  /**
   * Render a non-interactive `<span>` with no picker — the select-mode row, where the whole row
   * is one button and a nested control would be invalid HTML.
   */
  inert?: boolean;
}

/**
 * The **Folder** chip — the folder a row is labelled with, whether or not it has been dispatched
 * there. One chip for both surfaces (the detail panel and the row), opening the same picker and
 * writing through the same store action from either place.
 */
export function FolderChip({
  folderId,
  allowClear,
  onSelect,
  size = 'comfortable',
  inert = false,
}: FolderChipProperties) {
  const folders = useFolders();
  const folder = folders.find((f) => f.id === folderId);
  const label = folder?.name ?? 'No folder';

  if (size === 'compact') {
    // The row form renders only when a folder is set (the row never shows an empty field).
    if (folder === undefined) return null;
    if (inert) {
      return (
        <Badge variant="muted" className="inline-flex items-center gap-1 font-medium">
          <FolderOpen size={10} strokeWidth={2.2} className="shrink-0" />
          {folder.name}
        </Badge>
      );
    }
    return (
      <PickerChip
        trigger={
          <Badge
            asButton
            interactive
            variant="muted"
            aria-label={`Folder: ${folder.name}`}
            className="inline-flex items-center gap-1 font-medium hover:border-border"
          >
            <FolderOpen size={10} strokeWidth={2.2} className="shrink-0" />
            {folder.name}
          </Badge>
        }
        value={folderId}
        options={folderOptions(folders, allowClear ? 'No folder' : undefined)}
        onSelect={onSelect}
      />
    );
  }

  return (
    <PickerChip
      trigger={
        <Chip aria-label="Folder" className={cn(folder === undefined ? chipNeutral : chipTeal)}>
          <FolderOpen size={13} strokeWidth={2.2} className="shrink-0" />
          {label}
        </Chip>
      }
      value={folder?.id ?? null}
      options={folderOptions(folders, allowClear ? 'No folder' : undefined)}
      onSelect={onSelect}
    />
  );
}

interface IntendedProjectChipProperties {
  /** The pre-factory project hint (`intended_project_id`), or null when unset. */
  projectId: string | null;
  /** A pick auto-saves (`setIntendedProject` — a change clears the epic hint in the same PATCH). */
  onSelect: (projectId: string | null) => void;
}

/**
 * The **Project** detail chip — the pre-factory project hint, worn in the project's palette
 * colour (the same value the row's `ProjectKeyChip` wears) with the `GitBranch` glyph
 * `ProjectNav` and the command palette both use. The picker selects from what exists — creating
 * a project stays the gate's affordance.
 */
export function IntendedProjectChip({ projectId, onSelect }: IntendedProjectChipProperties) {
  const projects = useProjects();
  const project = projects.find((p) => p.id === projectId);
  return (
    <PickerChip
      trigger={
        <Chip
          aria-label="Project"
          className={cn(
            project === undefined
              ? chipNeutral
              : projectChipClasses(projectColorFor(projects, project.id)),
          )}
        >
          <GitBranch size={13} strokeWidth={2.2} className="shrink-0" />
          {project?.name ?? 'No project'}
        </Chip>
      }
      value={project?.id ?? null}
      options={projectOptions(projects, 'No project')}
      onSelect={onSelect}
    />
  );
}

interface IntendedEpicChipProperties {
  /** The project hint the epic list derives from — the chip disables while this is null. */
  projectId: string | null;
  /** The pre-factory epic hint (`intended_epic_id`), or null when unset. */
  epicId: string | null;
  /** A pick auto-saves (`setIntendedEpic`). */
  onSelect: (epicId: string | null) => void;
  /** `compact` — the row's ref-only pill; `comfortable` — the detail-panel chip (default). */
  size?: 'compact' | 'comfortable';
  /** Render a non-interactive `<span>` with no picker (the select-mode row). */
  inert?: boolean;
}

/**
 * The **Epic** chip — the pre-factory epic hint, styled as the project chip's sibling (the
 * project's colour). No glyph: the repo has no epic glyph, so the ref carries the identity, in
 * `font-mono` exactly as `ProjectKeyChip` sets a project key. Its picker lists the selected
 * project's epics; while no project is set the comfortable chip is disabled with a hint, since
 * there is no list to derive.
 */
export function IntendedEpicChip({
  projectId,
  epicId,
  onSelect,
  size = 'comfortable',
  inert = false,
}: IntendedEpicChipProperties) {
  const projects = useProjects();
  const epics = useEpics();
  const epic = epics.find((e) => e.id === epicId);
  const epicsForProject = epics.filter((e) => e.project_id === projectId);
  const color = projectColorFor(projects, projectId);

  if (size === 'compact') {
    // The row form renders only when an epic is set, beside the project chip.
    if (epic === undefined) return null;
    const compactClasses = cn('font-mono font-medium', projectBadgeClasses(color));
    if (inert) {
      return (
        <Badge variant="plain" className={compactClasses}>
          {epic.ref}
        </Badge>
      );
    }
    return (
      <PickerChip
        trigger={
          <Badge
            asButton
            interactive
            variant="plain"
            aria-label={`Epic: ${epic.ref}`}
            className={cn(compactClasses, 'hover:opacity-80')}
          >
            {epic.ref}
          </Badge>
        }
        value={epicId}
        options={epicOptions(epicsForProject)}
        onSelect={onSelect}
      />
    );
  }

  const trigger = (
    <Chip
      aria-label="Epic"
      disabled={projectId === null}
      title={projectId === null ? 'Pick a project first' : undefined}
      className={cn(
        epic === undefined ? chipNeutral : projectChipClasses(color),
        projectId === null && 'cursor-not-allowed opacity-50 hover:border-[#25324a]',
      )}
    >
      {epic === undefined ? (
        'No epic'
      ) : (
        <>
          <span className="font-mono">{epic.ref}</span>
          <span className="truncate">· {epic.name}</span>
        </>
      )}
    </Chip>
  );

  // A disabled trigger opens nothing — skip the popover entirely so the hint is the whole story.
  if (projectId === null) return trigger;

  return (
    <PickerChip
      trigger={trigger}
      value={epic?.id ?? null}
      options={epicOptions(epicsForProject, 'No epic')}
      onSelect={onSelect}
    />
  );
}
