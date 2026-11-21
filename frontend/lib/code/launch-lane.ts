/**
 * The launch lane of a recorded Claude Code session: which of alfred's launch prompts started it.
 * Stored on `code_sessions.launch_lane`. The record route reads it from the prompt the session
 * recorded (`laneOfPrompt`); the backfill infers it from the session's PR, and wins when it can.
 */

export const LAUNCH_LANES = [
  'refinement',
  'spike',
  'bug',
  'implementation',
  'bypass',
  'epic-refinement',
  'epic-implementation',
] as const;

export type LaunchLane = (typeof LAUNCH_LANES)[number];

/** A stored `launch_lane` value as a lane: the column is plain text, checked against this list. */
export function toLaunchLane(value: string | null | undefined): LaunchLane | null {
  return (LAUNCH_LANES as readonly unknown[]).includes(value) ? (value as LaunchLane) : null;
}

/**
 * Each lane's prompt, told apart by the sentence that opens its second paragraph (the first is
 * `<ref>: <title>`). These mirror the builders in `lib/code/links.ts`; a test round-trips every
 * builder through `laneOfPrompt`, so a copy edit there that breaks a match fails here.
 */
const LANE_OPENINGS: readonly (readonly [LaunchLane, RegExp])[] = [
  ['refinement', /^You are refining the ticket /],
  ['spike', /^You are running a SPIKE for the ticket /],
  ['bug', /^You are fixing the BUG /],
  ['implementation', /^You are implementing the ticket \S+\. Implement the merged spec/],
  ['bypass', /^You are implementing the ticket \S+\. This is a SKIP-REFINEMENT session/],
  ['epic-refinement', /^You are refining the EPIC /],
  ['epic-implementation', /^You are implementing the EPIC /],
];

/** The lane whose launch prompt `prompt` is, or null for any other prompt. */
export function laneOfPrompt(prompt: string): LaunchLane | null {
  const paragraphs = prompt.split(/\r?\n\s*\r?\n/);
  const opening = (paragraphs[1] ?? '').trimStart();
  return LANE_OPENINGS.find(([, pattern]) => pattern.test(opening))?.[0] ?? null;
}

/** How the story detail labels a session of each lane; an unknown lane reads plain "Session". */
const LANE_LABELS: Record<LaunchLane, string> = {
  refinement: 'Refinement session',
  spike: 'Spike session',
  bug: 'Bug-fix session',
  implementation: 'Implementation session',
  bypass: 'Skip-refinement session',
  'epic-refinement': 'Epic refinement session',
  'epic-implementation': 'Epic implementation session',
};

export function sessionLabel(lane: LaunchLane | null): string {
  return lane === null ? 'Session' : LANE_LABELS[lane];
}
