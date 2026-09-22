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

// ── Habit tracker — definitions plus one row per logged day. ──

/** The four stored day verdicts. `skipped` is the only one a caller ever states. */
export type HabitDayStatus = Database['public']['Enums']['habit_day_status'];

export type Habit = Database['public']['Tables']['habits']['Row'];
export type HabitInsert = Database['public']['Tables']['habits']['Insert'];
export type HabitUpdate = Database['public']['Tables']['habits']['Update'];

export type HabitEntry = Database['public']['Tables']['habit_entries']['Row'];
export type HabitEntryInsert = Database['public']['Tables']['habit_entries']['Insert'];

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

// ── PR ratio — the Dashboard's weekly merged-PR split across repos. ─────────

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

// ── Lines-changed velocity — the Dashboard's weekly churn series. ───────────

/** One calendar week of the velocity series. */
export interface LocWeek {
  /** ISO date of the week's Sunday, in UTC — e.g. '2026-09-06'. */
  week: string;
  /** Lines added + removed that week across every measured repo, by every non-bot author. */
  lines: number;
  /**
   * Trailing mean of `lines` over this week and the `averageWeeks - 1` before it, rounded.
   * `null` on the in-progress week, so the trend line stops at the last COMPLETE week.
   */
  average: number | null;
  /** True for the calendar week still in progress — its `lines` is a partial count. */
  partial: boolean;
}

/**
 * `GET /api/code/loc-velocity` — lines changed per week across the configured repos. Computed
 * live from GitHub, so it is neither persisted nor reconciled into any store.
 */
export interface LocVelocityResponse {
  /** One entry per week in the reported window, oldest first; the last is the week in progress. */
  weeks: LocWeek[];
  /** `owner/name` of every repo counted, in configured order. */
  repos: string[];
  /** The trailing window the `average` field was computed over. */
  averageWeeks: number;
}

// ── Weekly plan archive — one uploaded HTML document per week. ──

/** One archived weekly plan, document included. */
export type WeeklyPlan = Database['public']['Tables']['weekly_plans']['Row'];

/**
 * A plan without its document — the picker index. The `html` column is deliberately absent:
 * each plan is tens of KB, so only the selected one's document is ever in memory.
 */
export type WeeklyPlanSummary = Omit<WeeklyPlan, 'html'>;

// ── Comms (the communication firewall) — mirrored messages, verdicts, the roster. ──

/** The four triage tiers. The first three are counted; `fyi` is the unbadged shelf. */
export type CommTier = Database['public']['Enums']['comm_tier'];
/** Which kind of source an account is polled from. */
export type CommAccountKind = Database['public']['Enums']['comm_account_kind'];

export type CommAccount = Database['public']['Tables']['comm_accounts']['Row'];
export type CommAccountInsert = Database['public']['Tables']['comm_accounts']['Insert'];
export type CommAccountUpdate = Database['public']['Tables']['comm_accounts']['Update'];

export type CommMessage = Database['public']['Tables']['comm_messages']['Row'];
export type CommMessageInsert = Database['public']['Tables']['comm_messages']['Insert'];
export type CommMessageUpdate = Database['public']['Tables']['comm_messages']['Update'];

export type CommVerdict = Database['public']['Tables']['comm_verdicts']['Row'];
export type CommVerdictInsert = Database['public']['Tables']['comm_verdicts']['Insert'];

export type CommPerson = Database['public']['Tables']['comm_people']['Row'];
export type CommPersonInsert = Database['public']['Tables']['comm_people']['Insert'];
export type CommPersonUpdate = Database['public']['Tables']['comm_people']['Update'];

export type CommHandle = Database['public']['Tables']['comm_handles']['Row'];
export type CommHandleInsert = Database['public']['Tables']['comm_handles']['Insert'];

export type CommRubric = Database['public']['Tables']['comm_rubrics']['Row'];
export type CommRubricInsert = Database['public']['Tables']['comm_rubrics']['Insert'];

export type CommCorrection = Database['public']['Tables']['comm_corrections']['Row'];
export type CommCorrectionInsert = Database['public']['Tables']['comm_corrections']['Insert'];
export type CommCorrectionUpdate = Database['public']['Tables']['comm_corrections']['Update'];

/** The module-level classifier state — a singleton row, absent until the sweep first runs. */
export type CommClassifierHealth = Database['public']['Tables']['comm_classifier_health']['Row'];

/**
 * A roster person with the handles that resolve to them. The people list is keyed on the
 * human, never the address, so the editor always reads the two together.
 */
export interface CommPersonWithHandles extends CommPerson {
  comm_handles: CommHandle[];
}

/**
 * What the Comms queue view holds, read in one go — by the shell on a first load and by a
 * long-lived tab re-establishing itself whenever it may have missed something (ALF-258).
 *
 * The client holds everything above FYI but only a PAGE of the shelf, so the shelf's size and the
 * Reader's share of it arrive as counts rather than as rows.
 */
export interface CommsSeed {
  accounts: CommAccount[];
  /** Everything above FYI (the queue and anything not yet judged), then the newest shelf page. */
  messages: CommMessage[];
  /** The current verdict behind each of those messages. */
  verdicts: CommVerdict[];
  /** Absent until the classifier sweep has run at least once. */
  health: CommClassifierHealth | undefined;
  /** Every row on the shelf, not just the page in `messages`. */
  shelfCount: number;
  /** Shelf-eligible newsletters the Reader claimed — counted beneath the shelf, never drawn. */
  readerClaimedCount: number;
  /** The newest verdict across the whole window: the classifier's proof of life. */
  lastClassifiedAt: string | null;
  /**
   * When the server read this. Informational only — the client measures "Not live" against its
   * own clock (`lastReadAt`, captured when the read STARTED), never this, since only the
   * client's clock can be compared to the client's later reads.
   */
  readAt: string;
}

// ── Reader (newsletter posts pulled out of Comms and summarised) — ──

export type ReaderPublication = Database['public']['Tables']['reader_publications']['Row'];
export type ReaderPublicationInsert = Database['public']['Tables']['reader_publications']['Insert'];
export type ReaderPublicationUpdate = Database['public']['Tables']['reader_publications']['Update'];

export type ReaderPost = Database['public']['Tables']['reader_posts']['Row'];
export type ReaderPostInsert = Database['public']['Tables']['reader_posts']['Insert'];
export type ReaderPostUpdate = Database['public']['Tables']['reader_posts']['Update'];

/** The module-level tick state — a singleton row, seeded by the migration. */
export type ReaderHealth = Database['public']['Tables']['reader_health']['Row'];

/**
 * A post without its body — the list read's shape. A 30 KB body times hundreds of rows is a
 * seed the list never renders (the verb opens the original), so `getReaderSeed`, `getReaderPosts`
 * and `patchReaderPost` all select the shared `READER_POST_LIST_COLUMNS` instead of `*`.
 */
export type ReaderPostListItem = Omit<ReaderPost, 'text'>;

/**
 * A roster row with the date of its newest post — what `v_reader_publications` returns and what
 * the roster renders. Derived rather than stored: nothing writes back to the roster per post, so
 * "last post" is a `max(received_at)` over that publication's posts, null for one with none.
 */
export type ReaderPublicationListItem = ReaderPublication & { last_post_at: string | null };

/**
 * A bulk sender not on the roster, as `v_reader_candidates` ranks them: how much they send,
 * when they last did, and the display name they last used.
 *
 * Spelled out rather than taken from `Views['v_reader_candidates']['Row']`, because Postgres
 * views carry no NOT NULL metadata and the generated Row types EVERY column nullable — including
 * `handle` and `message_count`, which the view's own `group by` and `count(*)` make impossible to
 * be null. Reads override the query result with `.overrideTypes<ReaderCandidate[]>()`; this is
 * the shape they override to. `name` stays genuinely nullable: a sender whose every message
 * arrived with no display name has none, and the UI falls back to the handle.
 */
export interface ReaderCandidate {
  handle: string;
  name: string | null;
  message_count: number;
  last_seen_at: string;
}

/**
 * Everything the Reader's health surface is derived from, read together: the tick's singleton
 * row and the Gmail account its mail arrives on. A dead summariser and a dead mailbox are
 * different failures with different fixes, so the surface needs both or it can only guess.
 */
export interface ReaderHealthSnapshot {
  /** Absent until the tick has run at least once — that state means the cron has never fired. */
  health: ReaderHealth | undefined;
  /** Absent if the personal Gmail account has never been provisioned. */
  account: CommAccount | undefined;
}

/**
 * The four summary states `reader_posts.summary_state` is CHECKed down to. The column is a plain
 * `text` in the generated Row type (Postgres CHECKs, unlike enums, carry no type-level metadata),
 * so the union is declared by hand here rather than read off `Database`.
 */
export type ReaderSummaryState = 'pending' | 'done' | 'refused' | 'failed';

/** The shape `reader_posts.overview` holds for a `done` post — the model's structured take. */
export interface ReaderOverview {
  novel_ideas: string[];
  evidence: string[];
  argument: string;
  who_should_read: string;
}
