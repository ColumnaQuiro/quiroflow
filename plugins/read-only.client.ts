import { isAccountReadOnlyResponse } from '~/utils/supabaseFailures'

// Notices every write refused because the account is read-only, wherever it
// was made: straight through PostgREST (the read_only_while_unpaid trigger
// answers 423, PT423) or through a server route (requireActiveAccount answers
// 423). Both name the same reason, account_read_only.
//
// Watches window.fetch rather than each call site, for the reason
// utils/supabaseFailures.ts gives: some ninety writes are awaited without
// their result being read, and supabase-js and $fetch both look fetch up on
// every request. Only 423s are read, and only from a clone.
export default defineNuxtPlugin(() => {
  const { refusedAt } = useReadOnlyPrompt()
  const original = window.fetch
  if (typeof original !== 'function') return
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Called on the global: window.fetch throws "Illegal invocation" with any
    // other receiver.
    const response = await original.call(globalThis, input, init)
    if (response.status === 423) {
      response
        .clone()
        .text()
        .then((body) => {
          if (isAccountReadOnlyResponse(response.status, body)) refusedAt.value = Date.now()
        })
        .catch(() => {})
    }
    return response
  }
})
