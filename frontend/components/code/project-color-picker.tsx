'use client';

import { Check, RotateCcw } from 'lucide-react';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { OptionButton } from '@/components/atoms/option-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/atoms/popover';
import {
  PROJECT_COLORS,
  type ProjectColor,
  projectFillClasses,
  projectTextClasses,
} from '@/lib/code/project-color';
import { cn } from '@/lib/utils';

/** A palette key as a visible / accessible name: `amber` → `Amber`. */
export function projectColorLabel(color: ProjectColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

export interface ProjectColorPickerProperties {
  /** The stored pick, or `null` for Automatic (no pick — the project wears its slot colour). */
  value: ProjectColor | null;
  /** The project's creation-slot colour: what Automatic resolves to, named on its row. */
  slotColor: ProjectColor;
  /** A pick that changes the colour: a palette key, or `null` to return to Automatic. */
  onChange: (color: ProjectColor | null) => void;
  /** The control that opens the picker — becomes the Popover trigger (`asChild`). */
  children: React.ReactElement;
}

/**
 * The project colour picker: a row of the five palette swatches, then **Automatic** — the reset
 * that clears the pick, naming the slot colour it returns to so the owner knows what they'll get.
 *
 * The trigger is passed in as `children`, so the picker isn't tied to the board toolbar's button.
 * Every option is a toggle button (`aria-pressed`) in one labelled group, and the current one
 * carries a check as well as its ring, so the swatch colour is never the only cue. A pick closes
 * the popover; picking the option that's already current just closes, firing no `onChange`, so
 * it never costs a request. Radix owns Escape / outside-click dismissal and focus return.
 */
export function ProjectColorPicker({
  value,
  slotColor,
  onChange,
  children,
}: ProjectColorPickerProperties) {
  const [open, setOpen] = React.useState(false);
  const labelId = React.useId();

  const pick = (next: ProjectColor | null) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  const automatic = value === null;
  const slotLabel = projectColorLabel(slotColor);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-[184px]">
        <div role="group" aria-labelledby={labelId}>
          <p id={labelId} className="px-2 pt-1.5 pb-0.5 text-xs text-muted-foreground">
            Project color
          </p>
          <div className="flex gap-2 px-2 pt-1.5 pb-2">
            {PROJECT_COLORS.map((color) => {
              const pressed = value === color;
              return (
                <IconButton
                  key={color}
                  aria-label={projectColorLabel(color)}
                  aria-pressed={pressed}
                  onClick={() => {
                    pick(color);
                  }}
                  className="size-[22px] rounded-full focus-visible:ring-accent-teal focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1320]"
                >
                  {/* The disc owns the colour, so the button's hover tone can't tint its ring. */}
                  <span
                    data-testid="project-color-swatch"
                    className={cn(
                      'flex size-full items-center justify-center rounded-full',
                      projectFillClasses(color),
                      // The ring takes the swatch's own colour via `currentColor`.
                      projectTextClasses(color),
                      pressed && 'ring-2 ring-current ring-offset-2 ring-offset-[#0d1320]',
                    )}
                  >
                    {pressed ? (
                      <Check
                        size={12}
                        strokeWidth={3}
                        className="text-background"
                        data-testid="project-color-check"
                      />
                    ) : null}
                  </span>
                </IconButton>
              );
            })}
          </div>
          <div className="-mx-1 my-0.5 h-px bg-[#25324a]" />
          <OptionButton
            aria-label={`Automatic (${slotColor})`}
            aria-pressed={automatic}
            onClick={() => {
              pick(null);
            }}
            className="justify-start px-2 py-1.5 text-[13px] text-card-foreground"
          >
            <RotateCcw size={14} className="shrink-0" />
            Automatic
            <span className={cn('size-2 shrink-0 rounded-full', projectFillClasses(slotColor))} />
            <span className="text-muted-foreground">{slotLabel}</span>
            {automatic ? (
              <Check
                size={14}
                className="ml-auto shrink-0 text-accent-teal"
                data-testid="project-color-check"
              />
            ) : null}
          </OptionButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}
