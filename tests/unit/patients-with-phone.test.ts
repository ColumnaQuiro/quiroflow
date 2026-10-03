import { describe, it, expect } from 'vitest'
import { patientsWithPhone } from '../../utils/patientsWithPhone'

// A fake Supabase client over `rows` of patient_contact_numbers that behaves
// the way PostgREST does: an unranged select returns the first 1000 and stops,
// with no error. It records the filters and order each request asked for.
function client(rows: Array<{ id: string; account_id: string; patient_id: string; number: string; country_code: string }>, fail = false) {
  const requests: Array<{ table: string; account: string | null; order: string | null; range: [number, number] | null }> = []
  return {
    requests,
    from(table: string) {
      const req = { table, account: null as string | null, order: null as string | null, range: null as [number, number] | null }
      requests.push(req)
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          if (column === 'account_id') req.account = value
          return builder
        },
        order: (column: string) => {
          req.order = column
          return builder
        },
        range: (from: number, to: number) => {
          req.range = [from, to]
          return builder
        },
        then(resolve: (r: { data: unknown[] | null; error: unknown }) => unknown) {
          if (fail) return Promise.resolve(resolve({ data: null, error: new Error('read failed') }))
          let result = rows.filter((r) => r.account_id === req.account)
          if (req.order) result = [...result].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          const [from, to] = req.range ?? [0, 999]
          return Promise.resolve(resolve({ data: result.slice(from, Math.min(to, from + 999) + 1), error: null }))
        },
      }
      return builder
    },
  }
}

const ACCOUNT = 'ff112316-8768-4e5a-a495-b5025cefb6f2'

// Columnaquiro's shape on 3 Oct 2026: 1,560 numbers, Spanish, stored local.
function clinic(count = 1560) {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${String(i).padStart(5, '0')}`,
    account_id: ACCOUNT,
    patient_id: `patient-${i}`,
    number: String(600000000 + i),
    country_code: 'ES',
  }))
}

describe('patientsWithPhone', () => {
  it('finds a patient whose number is past the first 1000', async () => {
    const supabase = client(clinic())
    // Row 1,400: what an unpaged select never returned.
    expect([...(await patientsWithPhone(supabase, ACCOUNT, '34600001400'))]).to.deep.equal(['patient-1400'])
    expect([...(await patientsWithPhone(supabase, ACCOUNT, '34600001559'))]).to.deep.equal(['patient-1559'])
  })

  it('reads every page, ordered by id, inside the account', async () => {
    const supabase = client(clinic())
    await patientsWithPhone(supabase, ACCOUNT, '34600000001')
    expect(supabase.requests.every((r) => r.table === 'patient_contact_numbers' && r.account === ACCOUNT && r.order === 'id')).to.equal(true)
    expect(supabase.requests.map((r) => r.range?.[0])).to.include.members([0, 1000])
  })

  it('still matches a number stored with its dial code, and nothing else', async () => {
    const rows = clinic(1200)
    rows[1100] = { ...rows[1100], number: '+34 611 732 681' }
    const supabase = client(rows)
    expect([...(await patientsWithPhone(supabase, ACCOUNT, '34611732681'))]).to.deep.equal(['patient-1100'])
    expect((await patientsWithPhone(supabase, ACCOUNT, '34699999999')).size).to.equal(0)
  })

  it('ignores another account, and asks nothing for an empty phone', async () => {
    const supabase = client(clinic(10))
    expect((await patientsWithPhone(supabase, 'another-account', '34600000001')).size).to.equal(0)
    const quiet = client(clinic(10))
    expect((await patientsWithPhone(quiet, ACCOUNT, '')).size).to.equal(0)
    expect(quiet.requests).to.have.length(0)
  })

  it('throws on a failed read instead of answering "no match"', async () => {
    await expect(patientsWithPhone(client(clinic(), true), ACCOUNT, '34600001400')).rejects.toThrow('read failed')
  })
})
