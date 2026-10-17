import { describe, it, expect } from 'vitest'
import type { ErrorEvent } from '@sentry/core'
import { scrubBreadcrumb, scrubEvent, scrubUrl } from '../../utils/sentryPrivacy'

// utils/sentryPrivacy.ts: what leaves for Sentry. Which Supabase failures
// are worth an alert is tests/unit/supabase-failures.test.ts.

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
