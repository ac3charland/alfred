'use client';

import { Check } from 'lucide-react';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { FieldLabel } from '@/components/atoms/field-label';
import { InlineEditTrigger } from '@/components/atoms/inline-edit-trigger';
import { RecurrenceEditor } from '@/components/tasks/recurrence/recurrence-editor';
import { todayISODate } from '@/lib/date-utils';
import { presetForRule, ruleFromPreset, summarizeRule } from '@/lib/recurrence';
import type { RecurrencePreset, RecurrenceRule } from '@/lib/recurrence';

/** The preset menu (screenshot 1) minus Hourly, which is deferred (it needs a time anchor). */
const PRESET_MENU: { value: Exclude<RecurrencePreset, 'custom'>; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'every-3-months', label: 'Every 3 Months' },
  { value: 'every-6-months', label: 'Every 6 Months' },
  { value: 'yearly', label: 'Yearly' },
];

interface RepeatFieldProperties {
  /** The id the FieldLabel associates with. */
  fieldId: string;
  /** The current rule, or null when the task doesn't recur. */
  rule: RecurrenceRule | null;
  /** The task's due date, or null — the recurrence anchor falls back to today when absent. */
  dueDate: string | null;
  /**
   * Persist a rule (or null to clear). `anchorDate` is the due date the rule is anchored to;
   * the caller sets it as the task's due date when the task had none (setting a rule requires
   * an anchor).
   */
  onChange: (rule: RecurrenceRule | null, anchorDate: string) => void;
}

/**
 * The **Repeat** control in a task's meta panel (top-level tasks only): a trigger showing the
 * current rule's summary (or "Never"), a preset dropdown that check-marks the active preset and
 * offers `Custom…`, and the full custom editor. A preset writes its rule immediately; `Custom…`
 * opens the editor. Both anchor to the due date, defaulting to today when the task has none.
 */
export function RepeatField({ fieldId, rule, dueDate, onChange }: RepeatFieldProperties) {
  const [editorOpen, setEditorOpen] = React.useState(false);
  // Resolve the anchor once per render; presets and the editor share it.
  const anchorDate = dueDate ?? todayISODate();
  const activePreset = rule === null ? 'never' : presetForRule(rule);

  const selectPreset = (preset: Exclude<RecurrencePreset, 'custom'>) => {
    onChange(ruleFromPreset(preset, anchorDate), anchorDate);
  };

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel htmlFor={fieldId}>Repeat</FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <InlineEditTrigger
            id={fieldId}
            className="text-sm text-foreground hover:text-accent-teal transition-colors motion-reduce:transition-none focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {rule === null ? (
              <span className="text-muted-foreground">Never</span>
            ) : (
              summarizeRule(rule)
            )}
          </InlineEditTrigger>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PRESET_MENU.map((preset) => (
            <DropdownMenuItem
              key={preset.value}
              onSelect={() => {
                selectPreset(preset.value);
              }}
              className="justify-between"
            >
              {preset.label}
              {activePreset === preset.value && <Check size={12} className="text-accent-teal" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setEditorOpen(true);
            }}
            className="justify-between"
          >
            Custom…
            {activePreset === 'custom' && <Check size={12} className="text-accent-teal" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
    </div>
  );
}
