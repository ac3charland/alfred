import type { ReaderSummaryKind } from '@/lib/types';

/**
 * The three summary kinds as the owner picks between them — on a publication's card and on a
 * candidate's "Add as" — each named and told in one line by the question the summariser asks.
 */
export interface SummaryKindOption {
  value: ReaderSummaryKind;
  label: string;
  description: string;
}

export const SUMMARY_KIND_OPTIONS: readonly SummaryKindOption[] = [
  { value: 'essay', label: 'Essay', description: 'What’s new, the evidence, the argument' },
  { value: 'roundup', label: 'Roundup', description: 'Highlights, and the links worth reading' },
  {
    value: 'alerts',
    label: 'Alerts',
    description: 'Only sales, security, actions, changes — else archived',
  },
];

/** A kind's display name. */
export function summaryKindLabel(kind: ReaderSummaryKind): string {
  return SUMMARY_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? 'Essay';
}
