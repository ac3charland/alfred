/**
 * The task-row indentation math, in one place. A row's depth drives three rem offsets:
 * the row's own left padding, the meta panel's left margin (further right, clearing the
 * checkbox column), and the add-subtask capture box's padding one level deeper.
 *
 * The formulas (`depth * 1.25 + …`) were repeated at every indentation site in task-row;
 * they live here so a spacing change is a single edit.
 */
export interface Indentation {
  /** The row's own `paddingLeft` (`depth * 1.25 + 0.75` rem). */
  rowLeft: string;
  /** The meta panel's `marginLeft` (`depth * 1.25 + 2.5` rem). */
  metaLeft: string;
}

export function useIndentation(depth: number): Indentation {
  return {
    rowLeft: `${String(depth * 1.25 + 0.75)}rem`,
    metaLeft: `${String(depth * 1.25 + 2.5)}rem`,
  };
}
