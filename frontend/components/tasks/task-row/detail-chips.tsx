'use client';

import { Check, Repeat } from 'lucide-react';
import * as React from 'react';

import { Calendar } from '@/components/atoms/calendar';
import { Chip } from '@/components/atoms/chip';
import { OptionButton } from '@/components/atoms/option-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/atoms/popover';
import { RecurrenceEditor } from '@/components/tasks/recurrence/recurrence-editor';
import { formatDueDate, todayISODate } from '@/lib/date-utils';
import {
  PRIORITY_OPTIONS,
  type TaskPriority,
  isPriorityLevel,
  priorityOption,
} from '@/lib/priority';
import {
  REPEAT_PRESETS,
  type RecurrenceRule,
  presetForRule,
  ruleFromPreset,
  summarizeRule,
} from '@/lib/recurrence';
import { cn } from '@/lib/utils';

/** The neutral (unset) chip tone — slate text on a faint slate border. */
const chipNeutral = 'border-[#25324a] text-[#8A96A8] hover:border-[#34415a]';

/**
 * A row in a picker popover's list: a left-aligned option with an optional leading icon and a
 * trailing teal check when it's the current value. One styling source (the shared `OptionButton`
 * list-row atom) for the Repeat and Priority lists — the Due chip uses the calendar instead.
 */
function PickerListItem({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <OptionButton onClick={onSelect} className="text-[13px] text-card-foreground">
      <span className="flex items-center gap-2">{children}</span>
      {active && <Check size={14} className="shrink-0 text-accent-teal" />}
    </OptionButton>
  );
}

interface DueChipProperties {
  /** The current due date (`YYYY-MM-DD`), or null. */
  dueDate: string | null;
  /** Persist a picked date (auto-save). */
  onSelect: (iso: string) => void;
  /** Clear the due date (auto-save). */
  onClear: () => void;
}

/**
 * The **Due** detail chip: blue with the formatted date when set, neutral slate "Set a due
 * date…" when not. Opens the month-grid {@link Calendar}; picking a day or Today applies
 * immediately and closes, Clear removes the date.
 */
export function DueChip({ dueDate, onSelect, onClear }: DueChipProperties) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip
          aria-label="Due date"
          className={cn(
            dueDate ? 'border-accent-blue/30 bg-accent-blue/[0.08] text-accent-blue' : chipNeutral,
          )}
        >
          {dueDate ? formatDueDate(dueDate) : 'Set a due date…'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent>
        <Calendar
          selected={dueDate}
          onSelect={(iso) => {
            onSelect(iso);
            setOpen(false);
          }}
          onClear={() => {
            onClear();
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

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
 * slate on "Never". Opens a preset list (each with a trailing teal check on the active one) plus
 * a "Custom…" entry that opens the full {@link RecurrenceEditor}. A pick applies immediately.
 */
export function RepeatChip({ rule, dueDate, onChange }: RepeatChipProperties) {
  const [open, setOpen] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const anchorDate = dueDate ?? todayISODate();
  const activePreset = rule === null ? 'never' : presetForRule(rule);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Chip
            aria-label="Repeat"
            className={cn(
              rule === null
                ? chipNeutral
                : 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal',
            )}
          >
            <Repeat size={13} strokeWidth={2.2} className="shrink-0" />
            {rule === null ? 'Never' : summarizeRule(rule)}
          </Chip>
        </PopoverTrigger>
        <PopoverContent className="max-h-[264px] w-[186px] overflow-y-auto">
          {REPEAT_PRESETS.map((preset) => (
            <PickerListItem
              key={preset.value}
              active={activePreset === preset.value}
              onSelect={() => {
                onChange(ruleFromPreset(preset.value, anchorDate), anchorDate);
                setOpen(false);
              }}
            >
              {preset.label}
            </PickerListItem>
          ))}
          <PickerListItem
            active={activePreset === 'custom'}
            onSelect={() => {
              setOpen(false);
              setEditorOpen(true);
            }}
          >
            Custom…
          </PickerListItem>
        </PopoverContent>
      </Popover>

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

interface PriorityChipProperties {
  /** The current level, or null when unprioritised. */
  priority: TaskPriority | null;
  /** Persist a level, or null to clear (auto-save). */
  onChange: (next: TaskPriority | null) => void;
}

/**
 * The **Priority** detail chip: a level-coloured icon + label (High / Medium / Low), or a neutral
 * "No priority". Opens a list of "No priority" + the three levels, each with its icon and a
 * trailing teal check on the active one. A pick applies immediately and closes.
 */
export function PriorityChip({ priority, onChange }: PriorityChipProperties) {
  const [open, setOpen] = React.useState(false);
  const option = priorityOption(priority);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip
          aria-label="Priority"
          className={cn(option ? priorityChipTone[option.value] : chipNeutral)}
        >
          {option && <option.icon size={13} strokeWidth={2.6} className="shrink-0" />}
          {option?.label ?? 'No priority'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[186px]">
        <PickerListItem
          active={!isPriorityLevel(priority)}
          onSelect={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          <span className="text-[#8A96A8]">No priority</span>
        </PickerListItem>
        {PRIORITY_OPTIONS.map((opt) => (
          <PickerListItem
            key={opt.value}
            active={priority === opt.value}
            onSelect={() => {
              onChange(opt.value);
              setOpen(false);
            }}
          >
            <opt.icon
              size={14}
              strokeWidth={2.4}
              className={cn('shrink-0', priorityIconTone[opt.value])}
            />
            {opt.label}
          </PickerListItem>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Chip tint per priority level (text + faint bg + border), keyed off the level value. */
const priorityChipTone: Record<TaskPriority, string> = {
  high: 'border-accent-red/30 bg-accent-red/[0.12] text-accent-red',
  medium: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
  low: 'border-accent-blue/30 bg-accent-blue/10 text-accent-blue',
};

/** The list-item icon colour per priority level. */
const priorityIconTone: Record<TaskPriority, string> = {
  high: 'text-accent-red',
  medium: 'text-accent-amber',
  low: 'text-accent-blue',
};
