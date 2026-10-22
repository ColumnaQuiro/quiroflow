import { describe, it, expect } from 'vitest'
import type { ErrorEvent } from '@sentry/core'
import { redactText, scrubAppBreadcrumb, scrubAppEvent } from '../../mobile/utils/sentryAppPrivacy'

// mobile/utils/sentryAppPrivacy.ts: what the app sends to Sentry, on top of
// the web's rules (tests/unit/sentry-privacy.test.ts).

const ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b'
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123'

describe('Sentry privacy in the app', () => {
  it('replaces ids, emails, phone numbers and tokens in any text', () => {
    expect(redactText(`/patients/${ID}`)).to.eq('/patients/:id')
    expect(redactText('User already registered: ana.garcia+1@example.com')).to.eq('User already registered: [email]')
    expect(redactText('Key (phone)=(+34 600 123 456) already exists')).to.eq('Key (phone)=([number]) already exists')
    expect(redactText('600123456')).to.eq('[number]')
    expect(redactText(`Bearer ${JWT}`)).to.eq('Bearer [token]')
    // What a bug report needs survives.
    expect(redactText("Cannot read properties of undefined (reading 'id') at line 42")).to.eq("Cannot read properties of undefined (reading 'id') at line 42")
  })

  it('scrubs the message, the exception, the screen and the breadcrumbs of an event', () => {
    const event = {
      type: undefined,
      message: `Failed for ana@example.com`,
      transaction: `/patients/${ID}`,
      exception: { values: [{ type: 'Error', value: `duplicate key (phone)=(600123456) on ${ID}` }] },
      request: { url: `capacitor://localhost/reception/${ID}?tab=billing`, headers: { Referer: `capacitor://localhost/patients/${ID}` } },
      contexts: { vue: { componentName: 'PatientCard', propsData: { patient: { first_name: 'Ana' } } } },
      extra: { patient: 'Ana García' },
      breadcrumbs: [
        { category: 'console', message: 'Ana García' },
        { category: 'navigation', data: { from: `/patients/${ID}`, to: '/my-day' } },
        { category: 'fetch', data: { url: `https://x.supabase.co/rest/v1/rpc/claim_patient_profile?email=eq.ana@example.com`, method: 'POST' } },
        { category: 'ui.click', message: `button[data-patient="${ID}"]` },
      ],
    } as unknown as ErrorEvent

    const out = scrubAppEvent(event)
    expect(out.message).to.eq('Failed for [email]')
    expect(out.transaction).to.eq('/patients/:id')
    expect(out.exception!.values![0]!.value).to.eq('duplicate key (phone)=([number]) on :id')
    expect(out.request).to.deep.eq({ url: 'capacitor://localhost/reception/:id', headers: { Referer: 'capacitor://localhost/patients/:id' } })
    expect(out.contexts!.vue).to.deep.eq({ componentName: 'PatientCard' })
    expect(out.extra).to.eq(undefined)
    expect(out.breadcrumbs).to.have.length(3)
    expect(out.breadcrumbs![0]!.data).to.deep.eq({ from: '/patients/:id', to: '/my-day' })
    expect(out.breadcrumbs![1]!.data!.url).to.eq('https://x.supabase.co/rest/v1/rpc/claim_patient_profile')
    expect(out.breadcrumbs![2]!.message).to.eq('button[data-patient=":id"]')
    expect(JSON.stringify(out)).not.to.match(new RegExp(`Ana|600123456|example\\.com|${ID}`))
  })

  it('drops a console breadcrumb on its own too', () => {
    expect(scrubAppBreadcrumb({ category: 'console', message: 'x' })).to.eq(null)
    expect(scrubAppBreadcrumb({ category: 'navigation', data: { to: `/class/${ID}` } })).to.deep.eq({ category: 'navigation', data: { to: '/class/:id' } })
  })
})
