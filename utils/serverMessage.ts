/**
 * The message a server route actually sent, or null.
 *
 * Exists because `err.statusMessage` looks exactly like the right property
 * and is not. ofetch maps it to the HTTP response's statusText -- the reason
 * phrase -- and HTTP/2 removed reason phrases entirely, so in production it
 * is always the empty string. `err.statusMessage ?? fallback` therefore
 * returns '' rather than the fallback, and the user gets a toast with no
 * words in it: no message, no clue, nothing to report.
 *
 * It cannot be caught locally either. The dev server is HTTP/1.1, where
 * statusText is "Bad Request" -- already the wrong text, but visible, so the
 * code reads as working right up until it is deployed.
 *
 * What a route passes to createError({ statusMessage }) arrives in the
 * response body, which ofetch parses onto `err.data`. That is what the rest
 * of the app has always read.
 *
 * Empty strings are treated as absent, so a blank message can never win over
 * a caller's fallback again -- which is the whole failure this replaces.
 */
export function serverMessage(err: unknown): string | null {
  const data = (err as { data?: { statusMessage?: string; message?: string } })?.data
  const message = data?.statusMessage ?? data?.message
  return message && message.trim() ? message : null
}
