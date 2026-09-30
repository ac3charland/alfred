import type { Epic } from '@/lib/types';

/**
 * The epics a picker may offer as a destination for new work: the project's, minus the archived
 * ones — an archived epic is off the board, so nothing new belongs in it. The code store holds
 * every epic (the board's Show-archived toggle needs them), so each picker narrows through here
 * rather than filtering by `project_id` alone. Store order is kept.
 */
export function activeEpicsForProject(epics: readonly Epic[], projectId: string | null): Epic[] {
  return epics.filter((e) => e.project_id === projectId && e.archived_at === null);
}
