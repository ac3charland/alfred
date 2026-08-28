import * as React from 'react';

import { TextField, type TextFieldProperties } from './text-field';

export interface UnitFieldProperties extends TextFieldProperties {
  /**
   * What the number is measured in. Omitted when the number carries its own unit — a count of
   * glasses says "glasses" in the label beside it, and captioning it again would just be noise.
   */
  unit?: string | undefined;
}

/**
 * A `TextField` that says what its number is measured in.
 *
 * The unit sits beside the input rather than inside its label, so the caption stays with the
 * value while the label keeps naming the thing being recorded. It rides the field's
 * `aria-describedby` too: a unit only the sighted reader gets is a unit half the readers type
 * into blind.
 */
const UnitField = React.forwardRef<HTMLInputElement, UnitFieldProperties>(
  ({ unit, 'aria-describedby': describedBy, ...properties }, reference) => {
    const unitId = React.useId();
    // A caller's own description keeps its place ahead of the unit, which is the trailing caption.
    const described = [describedBy, unit === undefined ? undefined : unitId]
      .filter((id) => id !== undefined)
      .join(' ');

    return (
      <span className="inline-flex items-center gap-1">
        <TextField
          ref={reference}
          aria-describedby={described === '' ? undefined : described}
          {...properties}
        />
        {unit !== undefined && (
          <span id={unitId} className="text-[11px] text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
    );
  },
);
UnitField.displayName = 'UnitField';

export { UnitField };
