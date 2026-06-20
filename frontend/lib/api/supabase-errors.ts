import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Maps a Supabase/Postgres error to an HTTP status + message.
 *
 * Centralises what was previously per-handler ad-hoc logic (only `/api/projects`
 * mapped a unique violation; every other handler returned a flat 500). Now every
 * route's error branch goes through here so error codes are consistent:
 *
 *   - `23505` unique_violation       → 409 Conflict
 *   - `23503` foreign_key_violation  → 400 Bad Request
 *   - anything else                  → 500 Internal Server Error
 *
 * The Postgres error message is passed through verbatim (the existing handlers
 * already surfaced `error.message`).
 */
export function mapSupabaseError(error: PostgrestError): { status: number; message: string } {
  switch (error.code) {
    case '23505': {
      return { status: 409, message: error.message };
    }
    case '23503': {
      return { status: 400, message: error.message };
    }
    default: {
      return { status: 500, message: error.message };
    }
  }
}
