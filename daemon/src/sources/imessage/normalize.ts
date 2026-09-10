import type { NormalizedMessage } from '../../contract.ts';
import type { ChatDbRow } from './chat-db.ts';
import { decodeAttributedBody } from './typedstream.ts';

/**
 * chat.db's rows in, the ingest contract's messages out.
 *
 * Two conversions carry the weight here. Handles are written a dozen ways across chat.db and the
 * address book — `(312) 555-0100`, `+13125550100`, `Dana@Example.com` — and the same person has to
 * come out the same string every time, or the sender never matches a contact and every thread
 * splits in two. And dates are Apple's, counted from 2001 rather than 1970.
 */

/** 2001-01-01T00:00:00Z, in Unix milliseconds. Apple's epoch, not the Unix one. */
const APPLE_EPOCH_MS = 978_307_200_000;

/**
 * Below this, a raw chat.db date is whole seconds; at or above it, nanoseconds. Current macOS
 * writes nanoseconds (a number far past 2^53, which is why these stay `bigint` until the very
 * end), but a database restored from an older Mac can still hold the seconds form, and the two are
 * ~9 orders of magnitude apart — there is no ambiguous middle to get wrong.
 */
const NANOSECOND_FLOOR = 1_000_000_000_000n;

const NANOSECONDS_PER_MS = 1_000_000n;

/** North American numbers are stored without a country code often enough to be worth assuming. */
const US_NATIONAL_DIGITS = 10;

/** The sender of a message the owner sent. chat.db does not record which of their handles sent it. */
export const OWNER_HANDLE = 'me';

/** What a handle becomes when chat.db attributed the row to nobody at all. */
const UNKNOWN_HANDLE = 'unknown';

/**
 * One canonical spelling per person: `+13125550100` for a phone, `dana@example.com` for an email.
 * Anything that is neither — a short code, an Apple business id — is passed through cleaned but
 * not reshaped, because inventing a country code for a five-digit sender would be a wrong answer
 * rather than a missing one.
 */
export function normalizeHandle(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  if (trimmed.includes('@')) return trimmed.toLowerCase();

  const digits = trimmed.replaceAll(/\D/g, '');
  if (digits.length === 0) return trimmed.toLowerCase();
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === US_NATIONAL_DIGITS) return `+1${digits}`;
  if (digits.length === US_NATIONAL_DIGITS + 1 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

/** The instant a raw chat.db date stands for, as the wire contract's ISO 8601 string. */
export function appleDateToIso(raw: bigint): string {
  const milliseconds =
    raw < NANOSECOND_FLOOR ? Number(raw) * 1000 : Number(raw / NANOSECONDS_PER_MS);
  return new Date(milliseconds + APPLE_EPOCH_MS).toISOString();
}

/** An instant in the units current macOS compares `message.date` against. */
export function appleNanoseconds(at: Date): bigint {
  return BigInt(at.getTime() - APPLE_EPOCH_MS) * NANOSECONDS_PER_MS;
}

/** An instant in the units a pre-nanosecond chat.db compares `message.date` against. */
export function appleSeconds(at: Date): bigint {
  return BigInt(Math.floor((at.getTime() - APPLE_EPOCH_MS) / 1000));
}

export interface NormalizeDeps {
  /** Best-effort display name for a normalised handle. Absent is normal, never an error. */
  nameFor?: (handle: string) => string | undefined;
}

interface Body {
  text: string;
  extracted: boolean;
}

function bodyOf(row: ChatDbRow): Body {
  if (row.text !== undefined && row.text.length > 0) return { text: row.text, extracted: true };
  // No body and nothing to decode is an ordinary empty message (an attachment on its own, say) —
  // nothing failed, so nothing is flagged. Only a blob we could not read is an extraction failure.
  if (row.attributedBody === undefined) return { text: '', extracted: true };

  const decoded = decodeAttributedBody(row.attributedBody);
  return 'text' in decoded
    ? { text: decoded.text, extracted: true }
    : { text: '', extracted: false };
}

/**
 * A group is a chat with a room name or with more than one other participant. The distinction is
 * only about what to show: every message from a group is ingested either way, with its name and
 * membership attached, and the classifier decides whether being in it obliges the owner anything.
 */
function isGroup(row: ChatDbRow, participants: string[]): boolean {
  const roomName = row.chat?.roomName;
  return (roomName !== undefined && roomName.length > 0) || participants.length > 1;
}

export function toNormalizedMessage(row: ChatDbRow, deps: NormalizeDeps = {}): NormalizedMessage {
  const participants = row.chat?.participants.flatMap((handle) => {
    const normalized = normalizeHandle(handle);
    return normalized === undefined ? [] : [normalized];
  });
  const senderHandle = normalizeHandle(row.handle);
  const chat = row.chat;

  const message: NormalizedMessage = {
    source_id: row.guid,
    // The chat's guid is stable across renames and re-adds; the identifier and the sender's own
    // handle are only fallbacks for a row Messages never filed into a chat.
    thread_key: chat?.guid ?? chat?.identifier ?? senderHandle ?? UNKNOWN_HANDLE,
    direction: row.isFromMe ? 'outbound' : 'inbound',
    sender_handle: row.isFromMe ? OWNER_HANDLE : (senderHandle ?? UNKNOWN_HANDLE),
    participants: participants ?? [],
    body: '',
    received_at: appleDateToIso(row.date),
    body_extracted: true,
    has_attachments: row.hasAttachments,
    references_ids: [],
  };

  const body = bodyOf(row);
  message.body = body.text;
  message.body_extracted = body.extracted;

  const senderName =
    row.isFromMe || senderHandle === undefined ? undefined : deps.nameFor?.(senderHandle);
  if (senderName !== undefined && senderName.length > 0) message.sender_name = senderName;

  const chatName = chat?.displayName;
  if (chatName !== undefined && chatName.length > 0 && isGroup(row, message.participants)) {
    message.chat_name = chatName;
  }

  return message;
}
