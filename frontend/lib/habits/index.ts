/**
 * `lib/habits` — the habit tracker's pure domain logic, beside `lib/recurrence` and
 * `lib/priority`. Every export is a pure function of (habit definition, entries, today); no
 * fetching, no clock, no `Date` arithmetic on instants.
 */
export { statsWithBaseline } from '@/lib/habits/baseline';
export {
  deriveDayStatus,
  evaluateCriterion,
  parseCriteria,
  parseResults,
} from '@/lib/habits/criteria';
export {
  APP_WINDOW_DAYS,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  addDays,
  appWindow,
  daysBetween,
  eachDay,
  isoWeekday,
  resolveTimezone,
  resolveWindow,
  todayIn,
} from '@/lib/habits/dates';
export { toHabitsPayload } from '@/lib/habits/payload';
export {
  ESTABLISHED_DAYS,
  buildHabitCalendar,
  computeHabitStats,
  formationStage,
  isApplicableDay,
  isTrackableDay,
} from '@/lib/habits/streaks';
export type { DateWindow } from '@/lib/habits/dates';
export type {
  HabitEntryPayload,
  HabitPayload,
  HabitStatsPayload,
  HabitsPayload,
} from '@/lib/habits/payload';
export type {
  BooleanCriterion,
  CellStatus,
  Comparator,
  CriterionKind,
  DerivedStatus,
  FormationStage,
  HabitCriterion,
  HabitDay,
  HabitResults,
  HabitStats,
  MeasuredCriterion,
} from '@/lib/habits/types';
