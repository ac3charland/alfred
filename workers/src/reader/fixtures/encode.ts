/**
 * Encoding a fixture's body the way Gmail encodes a real one.
 *
 * Gmail hands every MIME part's body over as unpadded base64url, and `decodePart` in
 * `comms/email-text.ts` is what reverses it — so a fixture that carried plain text would exercise
 * a path the tick never takes. The fixtures below therefore hold readable HTML and prose in the
 * source, and this turns it into exactly what the wire carries at authoring time.
 *
 * `btoa` and `TextEncoder` rather than `Buffer`: the package's tsconfig declares no Node types, so
 * a fixture written against `node:buffer` would not type-check even though jest would run it.
 * `codePointAt` rather than `charCodeAt` because `unicorn/prefer-code-point` bans the latter.
 */

/** One part body, base64url-encoded and unpadded, exactly as `messages.get?format=full` returns it. */
export function encodeBody(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
