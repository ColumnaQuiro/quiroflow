import { describe, it, expect } from 'vitest'
import type { StreamedSpanJSON } from '@sentry/core'
import { DEFAULT_SERVER_TRACE_RATE, isCronRequest, nameRequestSpan, routeOfPath, serverTraceRate, serverTracesSampler } from '../../utils/sentryTracing'
import { scrubSpan, scrubUrlsInText } from '../../utils/sentryPrivacy'

// utils/sentryTracing.ts (how much is traced) and scrubSpan in
// utils/sentryPrivacy.ts (what a traced span may carry).

describe('Server trace sampling', () => {
  it('reads the rate from the environment, defaulting and clamping', () => {
    expect(serverTraceRate(undefined)).to.eq(DEFAULT_SERVER_TRACE_RATE)
    expect(serverTraceRate('')).to.eq(DEFAULT_SERVER_TRACE_RATE)
    expect(serverTraceRate('lots')).to.eq(DEFAULT_SERVER_TRACE_RATE)
    expect(serverTraceRate('0')).to.eq(0)
    expect(serverTraceRate('0.25')).to.eq(0.25)
    expect(serverTraceRate('5')).to.eq(1)
    expect(serverTraceRate('-1')).to.eq(0)
  })

  it('samples crons at a tenth of the rate', () => {
    expect(isCronRequest('POST /api/platform/supabase-usage-cron')).to.eq(true)
    expect(isCronRequest('POST /api/verifactu/send-cron')).to.eq(true)
    expect(isCronRequest('GET /patients/[id]')).to.eq(false)
    const sample = serverTracesSampler(0.1)
    expect(sample({ name: 'GET /calendar' })).to.eq(0.1)
    expect(sample({ name: 'POST /api/platform/supabase-usage-cron' })).to.be.closeTo(0.01, 1e-9)
    // What the SDK really passes: the method as the name, the path as an attribute.
    expect(sample({ name: 'POST', attributes: { 'url.path': '/api/platform/supabase-usage-cron' } })).to.be.closeTo(0.01, 1e-9)
    expect(sample({ name: 'GET', attributes: { 'url.path': '/calendar' } })).to.eq(0.1)
  })

  it('names a request span after its route, with ids folded', () => {
    expect(routeOfPath('/patients/3f2c9a10-1b2c-4d5e-8f90-123456789abc/visits/12')).to.eq('/patients/:id/visits/:id')
    expect(routeOfPath('/pay/a8Kd92jQx0')).to.eq('/pay/:id')
    expect(routeOfPath('/settings/team-members')).to.eq('/settings/team-members')
    expect(routeOfPath('/reserva-cita/columnaquiro')).to.eq('/reserva-cita/columnaquiro')

    const root = { name: 'GET', is_segment: true, attributes: { 'url.path': { value: '/patients/3f2c9a10-1b2c-4d5e-8f90-123456789abc', type: 'string' } } }
    expect(nameRequestSpan(root).name).to.eq('GET /patients/:id')
    const child = { name: 'GET', is_segment: false, attributes: { 'url.path': '/x' } }
    expect(nameRequestSpan(child).name).to.eq('GET')
    const named = { name: 'GET /api/x', is_segment: true, attributes: { 'url.path': '/api/x' } }
    expect(nameRequestSpan(named).name).to.eq('GET /api/x')
  })

  it('decides on its own even when the caller sent a decision', () => {
    // The browser traces nothing; inheriting its "no" would trace nothing here either.
    const sample = serverTracesSampler(0.1) as (ctx: { name: string; parentSampled?: boolean }) => number
    expect(sample({ name: 'GET /api/patients', parentSampled: false })).to.eq(0.1)
  })
})

describe('Span privacy', () => {
  it('drops query strings from URLs inside text', () => {
    expect(scrubUrlsInText('GET https://x.supabase.co/rest/v1/patients?first_name=ilike.*ana*&select=*')).to.eq('GET https://x.supabase.co/rest/v1/patients')
    expect(scrubUrlsInText('GET /patients?search=garcia#top')).to.eq('GET /patients')
    expect(scrubUrlsInText('GET /patients/[id]')).to.eq('GET /patients/[id]')
    expect(scrubUrlsInText('Is this ok? yes')).to.eq('Is this ok? yes')
  })

  it('scrubs the name and every attribute of a span', () => {
    const span = {
      trace_id: 't',
      span_id: 's',
      name: 'GET https://x.supabase.co/rest/v1/patients?phone=eq.600000000',
      start_timestamp: 0,
      status: 'ok',
      is_segment: false,
      attributes: {
        'http.method': 'GET',
        'url.full': 'https://x.supabase.co/rest/v1/patients?phone=eq.600000000',
        'url.query': '?phone=eq.600000000',
        'http.query': 'phone=eq.600000000',
        'http.target': '/rest/v1/patients?first_name=ilike.*Ana*',
        'db.query.text': "select * from patients where first_name = 'Ana'",
        'db.statement': "select * from patients where first_name = 'Ana'",
        'http.request.body': '{"first_name":"Ana"}',
        'sentry.op': 'http.client',
        'http.response.status_code': 200,
        'url.typed': { value: 'https://app.quiroflow.com/patients?search=Ana', type: 'string' },
      },
    } as unknown as StreamedSpanJSON

    const out = scrubSpan(span)
    expect(out.name).to.eq('GET https://x.supabase.co/rest/v1/patients')
    expect(out.attributes).to.deep.eq({
      'http.method': 'GET',
      'url.full': 'https://x.supabase.co/rest/v1/patients',
      'http.target': '/rest/v1/patients',
      'sentry.op': 'http.client',
      'http.response.status_code': 200,
      'url.typed': { value: 'https://app.quiroflow.com/patients', type: 'string' },
    })
    expect(JSON.stringify(out)).not.to.match(/Ana|600000000/)
  })

  it('keeps a Storage bucket but not the file name', () => {
    const span = {
      name: 'GET x.supabase.co',
      is_segment: false,
      attributes: {
        'url.full': 'https://x.supabase.co/storage/v1/object/patient-files/acc/pat/Informe Ana García.pdf',
        'url.signed': { value: 'https://x.supabase.co/storage/v1/object/sign/patient-files/acc/pat/informe-ana.pdf?token=abc', type: 'string' },
        'url.rest': 'https://x.supabase.co/rest/v1/patients',
      },
    } as unknown as StreamedSpanJSON

    const out = scrubSpan(span).attributes as Record<string, unknown>
    expect(out['url.full']).to.eq('https://x.supabase.co/storage/v1/object/patient-files/…')
    expect(out['url.signed']).to.deep.eq({ value: 'https://x.supabase.co/storage/v1/object/sign/patient-files/…', type: 'string' })
    expect(out['url.rest']).to.eq('https://x.supabase.co/rest/v1/patients')
    expect(JSON.stringify(out)).not.to.match(/ana|Ana|token/)
  })
})
