// alfred — convenience aliases over the generated Supabase schema types.
import type { Database } from '@/lib/database.types';
import type { WeekWindow } from '@/lib/github/week';

export type ItemType = Database['public']['Enums']['item_type'];
export type ItemStatus = Database['public']['Enums']['item_status'];
export type ItemPriority = Database['public']['Enums']['task_priority'];

export type Item = Database['public']['Tables']['items']['Row'];
export type ItemInsert = Database['public']['Tables']['items']['Insert'];
export type ItemUpdate = Database['public']['Tables']['items']['Update'];

export type Folder = Database['public']['Tables']['folders']['Row'];
export type FolderInsert = Database['public']['Tables']['folders']['Insert'];
export type FolderUpdate = Database['public']['Tables']['folders']['Update'];

// ── Software Factory (the `code` item type) — Project / Epic / Story model. ──

export type CodeFactoryState = Database['public']['Enums']['code_factory_state'];
export type CodeLane = Database['public']['Enums']['code_lane'];

export type Project = Database['public']['Tables']['projects']['Row'];
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
export type ProjectUpdate = Database['public']['Tables']['projects']['Update'];

export type Epic = Database['public']['Tables']['epics']['Row'];
export type EpicInsert = Database['public']['Tables']['epics']['Insert'];
export type EpicUpdate = Database['public']['Tables']['epics']['Update'];

export type CodeItem = Database['public']['Tables']['code_items']['Row'];
export type CodeItemInsert = Database['public']['Tables']['code_items']['Insert'];
export type CodeItemUpdate = Database['public']['Tables']['code_items']['Update'];

/** The flattened board read shape: a code story joined to its item, project, epic. */
export type CodeStory = Database['public']['Views']['v_code_stories']['Row'];

/** A row returned by the `get_subtree` RPC: an item plus its depth in the tree. */
export type SubtreeRow = Database['public']['Functions']['get_subtree']['Returns'][number];

// ── PR ratio — the Backlog's weekly merged-PR split across repos. ────────────

/** One repo's slice of the week: its merged-PR count and its share of the total. */
export interface PrRatioRepoCount {
  /** `owner/name`, e.g. 'ac3charland/realplay'. */
  repo: string;
  /** Display label for the bar segment and legend. */
  label: string;
  count: number;
  /** Integer share of `total`; the percentages across all repos sum to exactly 100. */
  percentage: number;
}

/**
 * The catch-all bucket: merged PRs in every repo OUTSIDE the configured set. It carries no
 * `repo` because it is not one repo, and its `percentage` shares the same 100 as `repos`.
 */
export interface PrRatioOtherCount {
  count: number;
  percentage: number;
}

/**
 * `GET /api/code/pr-ratio` — the merged-PR split for the seven days ending when the request
 * was made. `repos` preserves the configured order, which is the bar's left-to-right order.
 * Computed live from GitHub, so it is neither persisted nor reconciled into any store.
 *
 * `other` is ABSENT when the deployment can't measure the bucket at all, and present at zero
 * when it measured and found nothing — a distinction the card needs, since only the second
 * one is honestly "no PRs merged elsewhere in the window".
 */
export interface PrRatioResponse {
  week: WeekWindow;
  total: number;
  repos: PrRatioRepoCount[];
  other?: PrRatioOtherCount;
}

// ── Weekly plan archive — one uploaded HTML document per week. ──

/** One archived weekly plan, document included. */
export type WeeklyPlan = Database['public']['Tables']['weekly_plans']['Row'];

/**
 * A plan without its document — the picker index. The `html` column is deliberately absent:
 * each plan is tens of KB, so only the selected one's document is ever in memory.
 */
export type WeeklyPlanSummary = Omit<WeeklyPlan, 'html'>;
