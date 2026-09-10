/**
 * The retention sweep: every mirrored message is deleted once it is 60 days old.
 *
 * The driver is security rather than volume — a few thousand rows a year would never force the
 * question. alfred's copy of a message is safe to lose and not safe to keep indefinitely, and a
 * bounded window is what bounds the blast radius if this database is ever exposed. The sweep is
 * blanket: every tier, cleared or not, body included.
 *
 * Corrections are exempt and keep their denormalised text. They are what makes the example set
 * improve over time rather than resetting every two months, and a deliberate purge — a separate
 * action — is what reaches them.
 *
 * Nothing here reads the Worker's clock: the cutoff is computed in the database, so what gets
 * deleted never depends on which machine asked.
 */
import type { SupabaseEnv } from '../supabase';
import { sweepExpired } from './store';

/** How long a mirrored message lives. A comfort judgment of the owner's; nothing depends on 60. */
export const RETENTION_DAYS = 60;

/** What one retention run did. */
export interface RetentionSummary {
  deleted: number;
}

/** Delete every message past the retention window and report how many went. */
export async function runRetention(env: SupabaseEnv, _now: Date): Promise<RetentionSummary> {
  return { deleted: await sweepExpired(env, RETENTION_DAYS) };
}
