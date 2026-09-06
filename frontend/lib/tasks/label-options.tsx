import type { PickerChipOption } from '@/components/atoms/picker-chip';
import type { Epic, Folder, Project } from '@/lib/types';

/**
 * The option lists behind the three label pickers — folder, project, epic — in the one shape
 * both surfaces take ({@link PickerChipOption}). The detail/row chips build their popover lists
 * from these, and the row's ⋯ menu builds its submenus from the same ones, so a picker opened
 * from either place offers the same entries in the same order with the same two-column labels.
 *
 * Each builder takes an optional `clearLabel`: pass one ("No folder") and the list leads with
 * the `value: null` clear entry; omit it and there is none. That is the only axis on which the
 * three call sites differ — Folder offers the clear only while the row is undispatched (a
 * dispatched task must keep a folder), Project and Epic always do.
 *
 * A `.tsx` because the project and epic labels are two-column nodes, not strings. Pure
 * functions of their inputs, so they unit-test without rendering.
 */

/** The `value: null` clear entry every list may lead with, or nothing when unlabelled. */
function clearEntry(clearLabel: string | undefined): PickerChipOption[] {
  return clearLabel === undefined ? [] : [{ value: null, label: clearLabel }];
}

/** The folder rows: the folder name alone, in the sidebar's own order. */
export function folderOptions(folders: readonly Folder[], clearLabel?: string): PickerChipOption[] {
  return [...clearEntry(clearLabel), ...folders.map((f) => ({ value: f.id, label: f.name }))];
}

/** The project rows: name left, key right in mono — the gate's own listbox convention. */
export function projectOptions(
  projects: readonly Project[],
  clearLabel?: string,
): PickerChipOption[] {
  return [
    ...clearEntry(clearLabel),
    ...projects.map((p) => ({
      value: p.id,
      label: (
        <>
          <span className="truncate">{p.name}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground/70">{p.key}</span>
        </>
      ),
    })),
  ];
}

/**
 * The epic rows: name left, ref right in mono — the project list's sibling. An epic with no ref
 * yet (one created before its first story numbered it) renders the name alone rather than an
 * empty second column.
 */
export function epicOptions(epics: readonly Epic[], clearLabel?: string): PickerChipOption[] {
  return [
    ...clearEntry(clearLabel),
    ...epics.map((e) => ({
      value: e.id,
      label: (
        <>
          <span className="truncate">{e.name}</span>
          {e.ref !== '' && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground/70">{e.ref}</span>
          )}
        </>
      ),
    })),
  ];
}
