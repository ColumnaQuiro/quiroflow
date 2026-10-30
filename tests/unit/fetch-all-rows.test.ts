import { describe, it, expect } from 'vitest'
import { fetchAllRows } from '../../composables/useFetchAllRows'

// A table of `size` rows behind a fake range() query, recording which pages
// were asked for and in how many round-trips.
function table(size: number) {
  const rows = Array.from({ length: size }, (_, i) => i)
  const asked: number[][] = []
  let wave: number[] = []
  let flush: ReturnType<typeof setTimeout> | null = null
  const build = (from: number, to: number) => {
    wave.push(from)
    if (!flush) {
      flush = setTimeout(() => {
        asked.push(wave)
        wave = []
        flush = null
      }, 0)
    }
    return new Promise<{ data: number[]; error: null }>((resolve) => setTimeout(() => resolve({ data: rows.slice(from, to + 1), error: null }), 1))
  }
  return { rows, asked, build }
}

// A Supabase query builder the way postgrest-js behaves: .range() changes the
// builder in place and returns it, and nothing is sent until .then().
type Page = { data: number[]; error: null }
function lazyBuilder(size: number) {
  const rows = Array.from({ length: size }, (_, i) => i)
  let range: [number, number] = [0, 0]
  const builder = {
    range(from: number, to: number) {
      range = [from, to]
      return builder
    },
    then<A = Page, B = never>(onfulfilled?: ((v: Page) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
      const [from, to] = range
      return new Promise<Page>((resolve) => setTimeout(() => resolve({ data: rows.slice(from, to + 1), error: null }), 1)).then(onfulfilled, onrejected)
    },
  }
  return { rows, builder }
}

describe('fetchAllRows', () => {
  it('reads every row when the caller reuses one builder for every page', async () => {
    // (f, t) => query.range(f, t), as the dashboard widgets write it. Each page
    // has to be sent before the next .range() moves the shared builder on.
    for (const size of [1001, 2500, 5000, 9114]) {
      const { rows, builder } = lazyBuilder(size)
      expect(await fetchAllRows((f, t) => builder.range(f, t))).to.deep.equal(rows)
    }
  })

  it('reads every row, in order, with or without a count', async () => {
    for (const size of [0, 1, 999, 1000, 1001, 4000, 5000, 9114]) {
      const plain = table(size)
      expect(await fetchAllRows(plain.build)).to.deep.equal(plain.rows)
      const counted = table(size)
      expect(await fetchAllRows(counted.build, { total: Promise.resolve({ count: size }) })).to.deep.equal(counted.rows)
    }
  })

  it('asks for every remaining page at once when it knows the count', async () => {
    const t = table(9114)
    await fetchAllRows(t.build, { total: Promise.resolve({ count: 9114 }) })
    expect(t.asked.length).to.equal(2)
    expect(t.asked[1]).to.have.length(9)
  })

  it('still reads to the end when the count is short or missing', async () => {
    const short = table(9114)
    expect(await fetchAllRows(short.build, { total: Promise.resolve({ count: 3000 }) })).to.deep.equal(short.rows)
    const missing = table(9114)
    expect(await fetchAllRows(missing.build, { total: Promise.resolve({ count: null }) })).to.deep.equal(missing.rows)
  })
})
