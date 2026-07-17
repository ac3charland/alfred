/**
 * Instance identity, read from environment.
 *
 * alfred runs as two physically-isolated deployments — a Personal second brain and a Work one
 * — each a separate Vercel project pointed at its own Supabase database. They share no session
 * and no data; "switching" between them is just a full navigation to the other origin. This
 * helper turns the four `NEXT_PUBLIC_INSTANCE_*` env vars into a typed object so the header menu
 * never touches `process.env` directly and unconfigured local dev still renders sensibly.
 *
 * Each var is read by its literal name (never a computed key) because Next inlines
 * `NEXT_PUBLIC_*` references at build time — a dynamic lookup would not be replaced.
 */

/** The subset of the named-accent palette an instance may be tinted with (defaults to teal). */
export const ACCENT_TOKENS = ['teal', 'amber', 'blue', 'green'] as const;

export type AccentToken = (typeof ACCENT_TOKENS)[number];

/** Shown as the instance name when `NEXT_PUBLIC_INSTANCE_LABEL` is unset (local dev, one instance). */
const DEFAULT_LABEL = 'alfred';
const DEFAULT_ACCENT: AccentToken = 'teal';
/** Fallback label for the other instance when its URL is set but its label is not. */
const DEFAULT_OTHER_LABEL = 'Other';

export interface InstanceConfig {
  /** This instance's name, e.g. "Personal" — shown in the trigger pill and menu header. */
  label: string;
  /** Accent token tinting this instance so the current brain is unmistakable at a glance. */
  accent: AccentToken;
  /** The other instance to switch to, or `null` when no other-instance URL is configured. */
  other: { label: string; url: string } | null;
}

function isAccentToken(value: string | undefined): value is AccentToken {
  return value !== undefined && (ACCENT_TOKENS as readonly string[]).includes(value);
}

/** Trim and collapse a blank env value to `undefined`, so `??` defaults treat "" as unset. */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '') {
    return undefined;
  }
  return trimmed;
}

/**
 * Read the instance identity from `NEXT_PUBLIC_INSTANCE_*` with safe defaults: an unset label
 * falls back to "alfred", an unset/unknown accent to "teal", and — crucially — an unset
 * other-instance URL yields `other: null`, which hides the switch link on a single deployment.
 */
export function getInstanceConfig(): InstanceConfig {
  const label = envValue(process.env.NEXT_PUBLIC_INSTANCE_LABEL) ?? DEFAULT_LABEL;

  const accentRaw = envValue(process.env.NEXT_PUBLIC_INSTANCE_ACCENT);
  const accent = isAccentToken(accentRaw) ? accentRaw : DEFAULT_ACCENT;

  const otherUrl = envValue(process.env.NEXT_PUBLIC_OTHER_INSTANCE_URL);
  const otherLabel = envValue(process.env.NEXT_PUBLIC_OTHER_INSTANCE_LABEL) ?? DEFAULT_OTHER_LABEL;
  const other = otherUrl ? { label: otherLabel, url: otherUrl } : null;

  return { label, accent, other };
}
