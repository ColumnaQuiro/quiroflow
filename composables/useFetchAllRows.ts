// Supabase caps any unpaginated select() at 1000 rows -- silently, no error,
// no warning. Report pages here regularly deal with tables well past that
// (thousands of payments/invoices/appointments), so a plain .select() with
// no .range() quietly drops everything past row 1000. This fetches every
// page and concatenates the results. `build` is deliberately typed as any
// Postgrest builder call (not the exact PostgrestFilterBuilder generic,
// which varies by Supabase version) -- it just needs to be awaitable and
// yield { data, error }.
//
// The first page is fetched on its own, and only if it comes back full do
// the rest go out in parallel waves. Most callers here (a month of payments,
// one patient's invoices) fit in a single page, and those must stay at
// exactly one request -- fanning out speculatively would turn the common
// case into three wasted round-trips. Past that first page latency
// dominates: a 9-page table drops from 9 serial round-trips to 3.
//
// A short page means the end of the table, so anything requested past it in
// the same wave comes back empty and is ignored -- worst case CONCURRENCY-1
// wasted requests once per call, which is cheap next to the latency saved.
export async function fetchAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const PAGE_SIZE = 1000
  const CONCURRENCY = 4
  const all: T[] = []

  const { data: firstPage, error: firstError } = await build(0, PAGE_SIZE - 1)
  if (firstError) throw firstError
  if (!firstPage || firstPage.length === 0) return all
  all.push(...firstPage)
  if (firstPage.length < PAGE_SIZE) return all

  for (let wave = 0; ; wave++) {
    const pages = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_unused, i) => {
        // +1 because the first page is already in `all`.
        const from = (wave * CONCURRENCY + i + 1) * PAGE_SIZE
        return build(from, from + PAGE_SIZE - 1)
      }),
    )

    for (const { data, error } of pages) {
      if (error) throw error
      if (!data || data.length === 0) return all
      all.push(...data)
      if (data.length < PAGE_SIZE) return all
    }
  }
}
