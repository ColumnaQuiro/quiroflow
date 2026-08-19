// Supabase caps any unpaginated select() at 1000 rows -- silently, no error,
// no warning. Report pages here regularly deal with tables well past that
// (thousands of payments/invoices/appointments), so a plain .select() with
// no .range() quietly drops everything past row 1000. This fetches every
// page and concatenates the results. `build` is deliberately typed as any
// Postgrest builder call (not the exact PostgrestFilterBuilder generic,
// which varies by Supabase version) -- it just needs to be awaitable and
// yield { data, error }.
export async function fetchAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const PAGE_SIZE = 1000
  const all: T[] = []
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error } = await build(from, to)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return all
}
