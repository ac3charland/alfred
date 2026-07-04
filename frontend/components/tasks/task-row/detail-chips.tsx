'use client';

import { Check, Repeat } from 'lucide-react';
import * as React from 'react';

import { Chip } from '@/components/atoms/chip';
import { OptionButton } from '@/components/atoms/option-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/atoms/popover';
import { RecurrenceEditor } from '@/components/tasks/recurrence/recurrence-editor';
import { todayISODate } from '@/lib/date-utils';
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
 * trailing teal check when it's the current value. Styles the Repeat preset list off the shared
 * `OptionButton` list-row atom (Due uses the calendar; Priority uses the shared dropdown menu).
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
