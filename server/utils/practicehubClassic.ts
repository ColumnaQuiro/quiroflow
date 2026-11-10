// One GET against PracticeHub's Classic API, with its refusals put into
// words a clinic can act on.
//
// PracticeHub answers a wrong key with a bare 403 and a wrong address with a
// 404 page or no answer at all, and every import step used to show whichever
// of those as "PracticeHub API request failed". The clinic then had no way to
// tell a mistyped key from a mistyped address from PracticeHub being down,
// and the Connection step, where both are typed, said nothing until a later
// step failed. The texts here are matched by utils/importErrorText.ts, which
// restates them in the reader's language: change one, change both.
export async function practiceHubClassicGet<T>(
  conn: { baseUrl: string; apiKey: string; appDetails: string },
  path: string,
  query: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${conn.baseUrl.replace(/\/$/, '')}/api${path}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  try {
    return await $fetch<T>(url.toString(), {
      headers: { 'x-practicehub-key': conn.apiKey, 'x-app-details': conn.appDetails },
    })
  } catch (err: any) {
    const status: number | undefined = err?.response?.status
    const host = url.host
    if (status === 401 || status === 403) {
      throw createError({ statusCode: 403, statusMessage: `PracticeHub refused the API key (${status}). Check it under Developers > API Keys in PracticeHub and save it again in Settings > Import > Connection.` })
    }
    if (status === 404) {
      throw createError({ statusCode: 404, statusMessage: `Nothing answers at ${host}. Check the PracticeHub address in Settings > Import > Connection.` })
    }
    if (status === 429) {
      throw createError({ statusCode: 429, statusMessage: 'PracticeHub is rate-limiting; trying again shortly.' })
    }
    if (status === undefined) {
      throw createError({ statusCode: 502, statusMessage: `PracticeHub did not answer at ${host}. Check the address, or try again in a minute.` })
    }
    throw createError({ statusCode: status, statusMessage: err?.data?.message ?? 'PracticeHub API request failed' })
  }
}
