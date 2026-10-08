import { describe, it, expect } from 'vitest'
import type { ErrorEvent } from '@sentry/core'
import { reportSchemaMismatches, schemaMismatch, scrubBreadcrumb, scrubEvent, scrubUrl } from '../../utils/sentryPrivacy'

// utils/sentryPrivacy.ts: what leaves for Sentry, and which Supabase
// failures are worth an alert.

describe('Sentry privacy', () => {
  it('keeps the path and drops the query', () => {
    expect(scrubUrl('https://x.supabase.co/rest/v1/patients?first_name=ilike.*ana*&select=*')).to.eq('https://x.supabase.co/rest/v1/patients')
    expect(scrubUrl('/patients?search=garcia#top')).to.eq('/patients')
    expect(scrubUrl('/settings/team')).to.eq('/settings/team')
  })

  it('strips bodies, cookies, auth headers and console breadcrumbs from an event', () => {
    const event = {
      type: undefined,
      request: {
        url: 'https://app.quiroflow.com/patients?search=ana',
        query_string: 'search=ana',
        cookies: { 'sb-auth-token': 'secret' },
        data: '{"first_name":"Ana"}',
        headers: { Authorization: 'Bearer secret', 'User-Agent': 'Safari', Referer: 'https://app.quiroflow.com/recalls?tag=x' },
      },
      breadcrumbs: [
        { category: 'console', message: 'patient Ana García' },
        { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/patients?phone=eq.600000000', method: 'GET' } },
        { category: 'navigation', data: { from: '/patients?search=ana', to: '/patients/123' } },
      ],
    } as unknown as ErrorEvent

    const out = scrubEvent(event)
    expect(out.request).to.deep.eq({
      url: 'https://app.quiroflow.com/patients',
      headers: { 'User-Agent': 'Safari', Referer: 'https://app.quiroflow.com/recalls' },
    })
    expect(out.breadcrumbs).to.have.length(2)
    expect(out.breadcrumbs![0]!.data!.url).to.eq('https://x.supabase.co/rest/v1/patients')
    expect(out.breadcrumbs![1]!.data).to.deep.eq({ from: '/patients', to: '/patients/123' })
    expect(JSON.stringify(out)).not.to.match(/Ana|600000000|secret/)
  })

  it('drops a console breadcrumb on its own too', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'x' })).to.eq(null)
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'button.save' })).to.deep.eq({ category: 'ui.click', message: 'button.save' })
  })
})

describe('Supabase schema mismatches', () => {
  const url = 'https://x.supabase.co/rest/v1/payments?select=id,created_by&patient_id=eq.abc'

  it('reports a column, table, function or relationship that is not there', () => {
    expect(schemaMismatch(url, 400, { code: '42703', message: 'column payments.created_by does not exist' })).to.deep.eq({
      code: '42703',
      message: 'column payments.created_by does not exist',
      path: '/rest/v1/payments',
    })
    for (const code of ['42P01', '42883', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205']) {
      expect(schemaMismatch(url, 400, { code, message: 'm' })?.code).to.eq(code)
    }
  })

  it('leaves the app refusing something alone', () => {
    expect(schemaMismatch(url, 403, { code: '42501', message: 'new row violates row-level security policy' })).to.eq(null)
    expect(schemaMismatch(url, 400, { code: '23514', message: 'Account credit and write-offs are not money' })).to.eq(null)
    expect(schemaMismatch(url, 409, { code: '23505', message: 'duplicate key' })).to.eq(null)
    expect(schemaMismatch(url, 200, { code: '42703' })).to.eq(null)
    expect(schemaMismatch(url, 400, null)).to.eq(null)
  })

  it('only looks at the REST API', () => {
    expect(schemaMismatch('https://app.quiroflow.com/api/patients', 500, { code: '42703', message: 'm' })).to.eq(null)
  })

  it('reports through a wrapped fetch and still hands the caller the same response', async () => {
    const responses: Record<string, Response> = {
      'https://x.supabase.co/rest/v1/payments?select=created_by': new Response(JSON.stringify({ code: '42703', message: 'column payments.created_by does not exist' }), { status: 400 }),
      'https://x.supabase.co/rest/v1/payments?select=id': new Response(JSON.stringify({ code: '42501', message: 'rls' }), { status: 403 }),
      'https://elsewhere.test/rest/v1/x': new Response(JSON.stringify({ code: '42703', message: 'not ours' }), { status: 400 }),
    }
    const target = { fetch: (async (input: RequestInfo | URL) => responses[String(input)]!) as typeof fetch }
    const reported: string[] = []
    reportSchemaMismatches(target, 'https://x.supabase.co', (m) => reported.push(`${m.code} ${m.path}`))

    const res = await target.fetch('https://x.supabase.co/rest/v1/payments?select=created_by')
    expect(res.status).to.eq(400)
    expect((await res.json()).code, 'the caller can still read the body').to.eq('42703')
    await target.fetch('https://x.supabase.co/rest/v1/payments?select=id')
    await target.fetch('https://elsewhere.test/rest/v1/x')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(reported).to.deep.eq(['42703 /rest/v1/payments'])
  })
})
