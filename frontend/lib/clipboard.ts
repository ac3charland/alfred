/**
 * Best-effort copy of `text` to the system clipboard.
 *
 * Returns whether the write succeeded so callers can decide whether to confirm it to the user
 * (a "copied" toast) rather than promising a copy that silently failed. Guards `navigator.clipboard`
 * — it's absent in insecure (non-HTTPS) contexts and under jsdom — and swallows the write rejection
 * (a denied permission, or a lost user gesture) instead of throwing out of a click handler.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // The DOM lib types declare `navigator.clipboard` as always present, but at runtime it's absent
  // in insecure (non-HTTPS) contexts and under jsdom. Feature-detect with `in` (a genuine runtime
  // check, unlike a `=== undefined` comparison the types would call impossible); the try/catch
  // still covers a denied-permission rejection or a lost user gesture.
  if (!('clipboard' in navigator)) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
