/**
 * The research feature's configuration, read from environment.
 *
 * A research item is answered by a Claude Code Routine: the app fires it through the Routine's
 * API trigger (`RESEARCH_ROUTINE_FIRE_URL` + `RESEARCH_ROUTINE_FIRE_TOKEN`), and the Routine's
 * session PUTs its report back to the delivery route, which accepts `RESEARCH_DELIVERY_KEY` and
 * nothing else. All three, or the feature is off: `getResearchConfig()` is undefined, the routes
 * answer 501, and the Inbox offers no Research anywhere. None is `NEXT_PUBLIC_` — the fire token
 * starts the Routine and the delivery key writes reports, so both stay server-side, and only
 * whether the feature is configured crosses to the browser.
 */
import 'server-only';

export interface ResearchConfig {
  /** The Routine's API-trigger URL — `…/v1/claude_code/routines/<trigger>/fire`. */
  fireUrl: string;
  /** The trigger's bearer token. Starts this one Routine and nothing else. */
  fireToken: string;
  /** The key the delivery route accepts — and the only thing it accepts. */
  deliveryKey: string;
}

/** Trim and collapse a blank env value to `undefined`, so a var set to "" reads as unset. */
function envValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** The deployment's research config, or `undefined` unless all three values are set. */
export function getResearchConfig(): ResearchConfig | undefined {
  const fireUrl = envValue(process.env.RESEARCH_ROUTINE_FIRE_URL);
  const fireToken = envValue(process.env.RESEARCH_ROUTINE_FIRE_TOKEN);
  const deliveryKey = envValue(process.env.RESEARCH_DELIVERY_KEY);
  if (fireUrl === undefined || fireToken === undefined) return undefined;
  if (deliveryKey === undefined) return undefined;
  return { fireUrl, fireToken, deliveryKey };
}
