import { describe, it, expect } from 'vitest'
import { classifySupabaseFailure, classifySupabaseNetworkFailure, dataOrThrow, scrubPostgrestMessage, watchSupabaseFailures } from '../../utils/supabaseFailures'

// utils/supabaseFailures.ts: which Supabase responses count as a failed
// query, what is said about them, and that nothing patient-shaped is.

const table = 'https://x.supabase.co/rest/v1/payments?select=id,created_by&patient_id=eq.abc&phone=eq.600000000'
const rpc = 'https://x.supabase.co/rest/v1/rpc/get_my_bootstrap'

function classify(status: number, body: unknown, method = 'GET', url = table) {
  return classifySupabaseFailure({ url, method, status, body })
}

describe('classifySupabaseFailure', () => {
  it('reports a column, table, function or relationship that is not there, as a schema mismatch', () => {
    expect(classify(400, { code: '42703', message: 'column payments.created_by does not exist' })).to.deep.eq({
      status: 400,
      method: 'GET',
      code: '42703',
      message: 'column payments.created_by does not exist',
      path: '/rest/v1/payments',
      target: 'payments',
      schema: true,
      read: true,
    })
    for (const code of ['42P01', '42883', 'PGRST200', 'PGRST201', 'PGRST202', 'PGRST204', 'PGRST205']) {
      expect(classify(404, { code, message: 'm' })?.schema, code).to.eq(true)
    }
    // Their messages name schema objects, which is the whole point of them.
    expect(classify(400, { code: 'PGRST204', message: "Could not find the 'created_by' column of 'payments' in the schema cache" })?.message).to.contain("'created_by'")
  })

  it('reports a server error, a bad request and a read the role is not granted', () => {
    expect(classify(500, { code: 'XX000', message: 'internal error' })?.code).to.eq('XX000')
    expect(classify(400, { code: '22P02', message: 'invalid input syntax for type uuid: "abc"' })?.code).to.eq('22P02')
    expect(classify(400, { code: 'PGRST100', message: 'parse error' })?.code).to.eq('PGRST100')
    expect(classify(400, { code: '23502', message: 'null value in column "x" violates not-null constraint' }, 'POST')?.code).to.eq('23502')
    // RLS filters a select, it never refuses one: a forbidden read is a
    // table nobody granted.
    expect(classify(403, { code: '42501', message: 'permission denied for table payments' })?.code).to.eq('42501')
    expect(classify(403, { code: '42501', message: 'permission denied for table payments' }, 'HEAD')?.code).to.eq('42501')
    expect(classify(502, null)?.code).to.eq('http_502')
    expect(classify(500, null, 'HEAD')?.code, 'a HEAD has no body to carry a code').to.eq('http_500')
  })

  it('names the table or the function, the method, and whether it was a read', () => {
    expect(classify(500, { code: 'XX000', message: 'm' }, 'POST', rpc)).to.include({ target: 'rpc/get_my_bootstrap', path: '/rest/v1/rpc/get_my_bootstrap', method: 'POST', read: true })
    expect(classify(500, { code: 'XX000', message: 'm' }, 'patch')).to.include({ target: 'payments', method: 'PATCH', read: false })
    expect(classify(500, { code: 'XX000', message: 'm' }, 'DELETE')?.read).to.eq(false)
    expect(classify(500, { code: 'XX000', message: 'm' }, 'HEAD')?.read).to.eq(true)
  })

  it('leaves alone what the call sites handle themselves', () => {
    expect(classify(200, { code: '42703' }), 'a success').to.eq(null)
    expect(classify(401, { code: 'PGRST301', message: 'JWT expired' }), 'an expired session').to.eq(null)
    expect(classify(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }), 'maybeSingle with no row').to.eq(null)
    expect(classify(409, { code: '23505', message: 'duplicate key value violates unique constraint' }, 'POST'), 'a conflict').to.eq(null)
    expect(classify(409, { code: '23503', message: 'still referenced' }, 'DELETE'), 'a conflict').to.eq(null)
    expect(classify(416, { code: 'PGRST103', message: 'Requested range not satisfiable' }), 'a page past the end').to.eq(null)
    expect(classify(403, { code: '42501', message: 'new row violates row-level security policy' }, 'POST'), 'RLS refusing a write').to.eq(null)
    expect(classify(403, { code: '42501', message: 'new row violates row-level security policy' }, 'PATCH')).to.eq(null)
    expect(classify(403, { code: '42501', message: 'Not authenticated' }, 'POST', rpc), 'a definer RPC before the second factor').to.eq(null)
    expect(classify(400, { code: 'P0001', message: 'Two-factor authentication required' }, 'POST', rpc), 'a rule stated by the database').to.eq(null)
    expect(classify(400, { code: 'P0001', message: 'Only an owner can change fees' }, 'PATCH')).to.eq(null)
    expect(classify(400, { code: '23514', message: 'Account credit and write-offs are not money' }, 'POST'), 'a check constraint').to.eq(null)
  })

  it('only looks at the REST API', () => {
    expect(classify(500, { code: 'XX000', message: 'm' }, 'POST', 'https://x.supabase.co/auth/v1/token?grant_type=password')).to.eq(null)
    expect(classify(400, { code: '42703', message: 'm' }, 'POST', 'https://x.supabase.co/storage/v1/object/sign/whatsapp-media')).to.eq(null)
    expect(classify(500, { code: '42703', message: 'm' }, 'GET', 'https://app.quiroflow.com/api/patients')).to.eq(null)
  })

  it('never carries a filter value, a row or a query string', () => {
    const failure = classify(400, { code: '22P02', message: 'invalid input syntax for type uuid: "Ana García"', details: 'Key (phone)=(600000000) already exists.', hint: 'Ana' }, 'POST')
    expect(JSON.stringify(failure)).not.to.match(/Ana|600000000|select=|patient_id=/)
    expect(failure?.message).to.eq('invalid input syntax for type uuid: "…"')
  })
})

describe('scrubPostgrestMessage', () => {
  it('takes out quoted values, keyed values and long numbers', () => {
    expect(scrubPostgrestMessage('Key (phone)=(600000000) already exists.')).to.eq('Key (phone)=(…) already exists.')
    expect(scrubPostgrestMessage("invalid input value for enum status: 'Ana'")).to.eq("invalid input value for enum status: '…'")
    expect(scrubPostgrestMessage('date/time field value out of range: "2026-13-45"')).to.eq('date/time field value out of range: "…"')
    expect(scrubPostgrestMessage('value 12345678A too long')).to.eq('value …A too long')
    expect(scrubPostgrestMessage('column 42 is fine')).to.eq('column 42 is fine')
    expect(scrubPostgrestMessage('x'.repeat(500))).to.have.length(300)
  })
})

describe('classifySupabaseNetworkFailure', () => {
  it('reports a request that never got a response, unless it was aborted', () => {
    expect(classifySupabaseNetworkFailure(table, 'GET', new TypeError('Failed to fetch'))).to.include({ status: 0, code: 'network', target: 'payments', read: true })
    expect(classifySupabaseNetworkFailure(table, 'GET', Object.assign(new Error('aborted'), { name: 'AbortError' }))).to.eq(null)
    expect(classifySupabaseNetworkFailure('https://x.supabase.co/auth/v1/token', 'POST', new TypeError('Failed to fetch'))).to.eq(null)
  })
})

describe('watchSupabaseFailures', () => {
  function target(responses: Record<string, Response | Error>) {
    return {
      fetch: (async (input: RequestInfo | URL) => {
        const r = responses[String(input)]!
        if (r instanceof Error) throw r
        return r
      }) as typeof fetch,
    }
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('reports through a wrapped fetch and still hands the caller the same response', async () => {
    const t = target({
      'https://x.supabase.co/rest/v1/payments?select=created_by': new Response(JSON.stringify({ code: '42703', message: 'column payments.created_by does not exist' }), { status: 400 }),
      'https://x.supabase.co/rest/v1/payments?select=id': new Response(JSON.stringify({ code: '42501', message: 'rls' }), { status: 403 }),
      'https://x.supabase.co/rest/v1/payments?select=ok': new Response('[]', { status: 200 }),
      'https://elsewhere.test/rest/v1/x': new Response(JSON.stringify({ code: '42703', message: 'not ours' }), { status: 400 }),
    })
    const reported: string[] = []
    watchSupabaseFailures(t, 'https://x.supabase.co', (f) => reported.push(`${f.code} ${f.method} ${f.target}`))

    const res = await t.fetch('https://x.supabase.co/rest/v1/payments?select=created_by')
    expect(res.status).to.eq(400)
    expect((await res.json()).code, 'the caller can still read the body').to.eq('42703')
    await t.fetch('https://x.supabase.co/rest/v1/payments?select=id', { method: 'POST' })
    await t.fetch('https://x.supabase.co/rest/v1/payments?select=ok')
    await t.fetch('https://elsewhere.test/rest/v1/x')
    await tick()

    expect(reported).to.deep.eq(['42703 GET payments'])
  })

  it('reports a HEAD with no body, by its status', async () => {
    const t = target({ 'https://x.supabase.co/rest/v1/patients?select=id': new Response(null, { status: 500 }) })
    const reported: string[] = []
    watchSupabaseFailures(t, 'https://x.supabase.co', (f) => reported.push(`${f.code} ${f.method}`))
    await t.fetch('https://x.supabase.co/rest/v1/patients?select=id', { method: 'HEAD' })
    await tick()
    expect(reported).to.deep.eq(['http_500 HEAD'])
  })

  it('reports a dropped request and still rejects for the caller', async () => {
    const t = target({ 'https://x.supabase.co/rest/v1/patients?select=id': new TypeError('Failed to fetch') })
    const reported: string[] = []
    watchSupabaseFailures(t, 'https://x.supabase.co', (f) => reported.push(f.code))
    await expect(t.fetch('https://x.supabase.co/rest/v1/patients?select=id')).rejects.to.be.instanceOf(TypeError)
    expect(reported).to.deep.eq(['network'])
  })

  it('does nothing without a URL to watch', () => {
    const t = target({})
    const before = t.fetch
    watchSupabaseFailures(t, '', () => {})
    expect(t.fetch).to.eq(before)
  })
})

describe('dataOrThrow', () => {
  it('hands back the data, or throws the error', () => {
    expect(dataOrThrow({ data: [1, 2], error: null })).to.deep.eq([1, 2])
    expect(dataOrThrow({ data: null, error: null }), 'maybeSingle with no row').to.eq(null)
    const error = Object.assign(new Error('column x does not exist'), { code: '42703' })
    expect(() => dataOrThrow({ data: null, error })).to.throw('column x does not exist')
  })
})
