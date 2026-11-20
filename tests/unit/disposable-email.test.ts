import { afterEach, describe, expect, it, vi } from 'vitest'
import { emailDomain, isListedDomain, parseDomainList } from '../../server/utils/disposableEmail'

describe('reading a blocklist', () => {
  it('keeps one lower-cased domain per line and drops comments and blanks', () => {
    const text = '# Fake and Temp Mail Providers\n\nTempInbox.example\n  other-temp.example  \r\n# trailing\n'
    expect(parseDomainList(text)).toEqual(['tempinbox.example', 'other-temp.example'])
  })
})

describe('the domain of an address', () => {
  it('is what follows the last @, lower-cased', () => {
    expect(emailDomain('Someone@Temp-Inbox.Example')).toBe('temp-inbox.example')
    expect(emailDomain('"odd@local"@temp-inbox.example')).toBe('temp-inbox.example')
  })

  it('is empty when there is no @', () => {
    expect(emailDomain('not-an-address')).toBe('')
  })
})

describe('whether a domain is a throwaway inbox', () => {
  const listed = new Set(['temp-inbox.example', 'gmail.com'])

  it('matches the domain itself', () => {
    expect(isListedDomain('temp-inbox.example', listed)).toBe(true)
  })

  it('matches a subdomain the service hands out', () => {
    expect(isListedDomain('mx2.inbox.temp-inbox.example', listed)).toBe(true)
  })

  it('does not match a domain that merely ends in the same letters', () => {
    expect(isListedDomain('nottemp-inbox.example', listed)).toBe(false)
  })

  it('never refuses a mainstream provider, even if a list wrongly names it', () => {
    expect(isListedDomain('gmail.com', listed)).toBe(false)
  })

  it('lets a clinic’s own domain through', () => {
    expect(isListedDomain('clinicademo.es', listed)).toBe(false)
  })
})

describe('checking an address against the live lists', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('refuses a listed domain and fetches the lists once for many checks', async () => {
    const fetchMock = vi.fn(async () => new Response('# list\nfresh-temp.example\n'))
    vi.stubGlobal('fetch', fetchMock)
    const { isDisposableEmail } = await import('../../server/utils/disposableEmail')

    expect(await isDisposableEmail('someone@fresh-temp.example')).toBe(true)
    expect(await isDisposableEmail('owner@clinicademo.es')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2) // one per source, then cached
  })

  it('still refuses the always-blocked domains when the lists cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { isDisposableEmail } = await import('../../server/utils/disposableEmail')

    expect(await isDisposableEmail('someone@yopmail.com')).toBe(true)
    expect(await isDisposableEmail('owner@clinicademo.es')).toBe(false)
  })
})
