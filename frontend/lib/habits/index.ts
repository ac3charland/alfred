/**
 * `lib/habits` — the habit tracker's pure domain logic, beside `lib/recurrence` and
 * `lib/priority`. Every export is a pure function of (habit definition, entries, today); no
 * fetching, no clock, no `Date` arithmetic on instants.
 */
export {
  deriveDayStatus,
  evaluateCriterion,
  parseCriteria,
  parseResults,
} from '@/lib/habits/criteria';
export { addDays, daysBetween, eachDay, isoWeekday, todayIn } from '@/lib/habits/dates';
export {
  buildHabitCalendar,
  computeHabitStats,
  formationStage,
  isApplicableDay,
} from '@/lib/habits/streaks';
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
