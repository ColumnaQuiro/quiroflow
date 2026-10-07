import { describe, it, expect } from 'vitest'
import { whatsappRecipient } from '../../utils/whatsappRecipient'

type ContactNumber = { id: string; account_id: string; patient_id: string; number: string; country_code: string }
type Patient = { id: string; account_id: string; is_minor: boolean; do_not_contact: boolean }

// A fake Supabase client that behaves the way PostgREST does: a select with no
// .range() returns the first 1000 rows and stops, with no error. `fail` names
// a table whose reads come back as { data: null, error }.
function client(numbers: ContactNumber[], patients: Patient[], fail?: 'patient_contact_numbers' | 'patients') {
  const requests: Array<{ table: string; eq: Record<string, string>; order: string | null; range: [number, number] | null }> = []
  return {
    requests,
    from(table: string) {
      const req = { table, eq: {} as Record<string, string>, in: null as string[] | null, order: null as string | null, range: null as [number, number] | null }
      requests.push(req)
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          req.eq[column] = value
          return builder
        },
        in: (_column: string, values: string[]) => {
          req.in = values
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
          if (fail === table) return Promise.resolve(resolve({ data: null, error: new Error(`${table} read failed`) }))
          const source: Array<{ id: string; account_id: string }> = table === 'patients' ? patients : numbers
          let rows = source.filter((r) => Object.entries(req.eq).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
          if (req.in) rows = rows.filter((r) => req.in!.includes(r.id))
          if (req.order) rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          const [from, to] = req.range ?? [0, 999]
          return Promise.resolve(resolve({ data: rows.slice(from, Math.min(to, from + 999) + 1), error: null }))
        },
      }
      return builder
    },
  }
}

const ACCOUNT = 'ff112316-8768-4e5a-a495-b5025cefb6f2'

// Columnaquiro's shape on 3 Oct 2026: 1,560 numbers, Spanish, stored local,
// one patient each.
function clinic(count = 1560) {
  const numbers: ContactNumber[] = []
  const patients: Patient[] = []
  for (let i = 0; i < count; i++) {
    numbers.push({ id: `n-${String(i).padStart(5, '0')}`, account_id: ACCOUNT, patient_id: `p-${i}`, number: String(600000000 + i), country_code: 'ES' })
    patients.push({ id: `p-${i}`, account_id: ACCOUNT, is_minor: false, do_not_contact: false })
  }
  return { numbers, patients }
}

describe('whatsappRecipient', () => {
  it('refuses a do-not-contact patient whose number is past the first 1000', async () => {
    const { numbers, patients } = clinic()
    patients[1400].do_not_contact = true
    // Row 1,400: the unpaged select never returned it, so this resolved to
    // nobody and the message went out.
    expect(await whatsappRecipient(client(numbers, patients), ACCOUNT, '34600001400')).to.deep.equal({ patientId: 'p-1400', blocked: true })
  })

  it('refuses a minor on the last row', async () => {
    const { numbers, patients } = clinic()
    patients[1559].is_minor = true
    expect((await whatsappRecipient(client(numbers, patients), ACCOUNT, '34600001559')).blocked).to.equal(true)
  })

  it('lets an ordinary patient past row 1000 through, attributed to them', async () => {
    const { numbers, patients } = clinic()
    expect(await whatsappRecipient(client(numbers, patients), ACCOUNT, '34600001200')).to.deep.equal({ patientId: 'p-1200', blocked: false })
  })

  it('reads the numbers page by page, ordered by id, inside the account', async () => {
    const { numbers, patients } = clinic()
    const supabase = client(numbers, patients)
    await whatsappRecipient(supabase, ACCOUNT, '34600001200')
    const reads = supabase.requests.filter((r) => r.table === 'patient_contact_numbers')
    expect(reads.every((r) => r.eq.account_id === ACCOUNT && r.order === 'id')).to.equal(true)
    expect(reads.map((r) => r.range?.[0])).to.include.members([0, 1000])
    expect(supabase.requests.filter((r) => r.table === 'patients').every((r) => r.eq.account_id === ACCOUNT)).to.equal(true)
  })

  it('matches a number stored with its dial code, which the exact E.164 comparison missed', async () => {
    const { numbers, patients } = clinic(1200)
    numbers[1100].number = '+34 611 732 681'
    patients[1100].do_not_contact = true
    expect((await whatsappRecipient(client(numbers, patients), ACCOUNT, '34611732681')).blocked).to.equal(true)
  })

  it('refuses a shared number when any patient on it cannot be contacted', async () => {
    const { numbers, patients } = clinic(1200)
    // A parent at row 10 and their child at row 1100, on the same phone.
    numbers[1100].number = numbers[10].number
    patients[1100].is_minor = true
    expect(await whatsappRecipient(client(numbers, patients), ACCOUNT, '34600000010')).to.deep.equal({ patientId: 'p-10', blocked: true })
  })

  it('reaches nobody for an unknown number, or another account\'s', async () => {
    const { numbers, patients } = clinic(10)
    expect(await whatsappRecipient(client(numbers, patients), ACCOUNT, '34699999999')).to.deep.equal({ patientId: null, blocked: false })
    expect(await whatsappRecipient(client(numbers, patients), 'another-account', '34600000001')).to.deep.equal({ patientId: null, blocked: false })
  })

  it('throws on a failed read instead of answering "nobody", which would send', async () => {
    const { numbers, patients } = clinic()
    patients[1400].do_not_contact = true
    await expect(whatsappRecipient(client(numbers, patients, 'patient_contact_numbers'), ACCOUNT, '34600001400')).rejects.toThrow('patient_contact_numbers read failed')
    await expect(whatsappRecipient(client(numbers, patients, 'patients'), ACCOUNT, '34600001400')).rejects.toThrow('patients read failed')
  })
})
