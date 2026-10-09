import { describe, expect, it } from 'vitest'
import { devicePlatform, directionsUrl, telUrl } from '../../utils/clinicLinks'

const clinic = { name: 'Clínica Demo', address: 'Calle Mayor 12, Valencia', phone: '+34 961 23 45 67' }

describe('directions to the clinic', () => {
  it('opens Apple Maps on an iPhone and Google Maps elsewhere, by name and address', () => {
    expect(directionsUrl(clinic, 'ios')).toBe('https://maps.apple.com/?q=Cl%C3%ADnica%20Demo%2C%20Calle%20Mayor%2012%2C%20Valencia')
    expect(directionsUrl(clinic, 'android')).toBe('https://www.google.com/maps/search/?api=1&query=Cl%C3%ADnica%20Demo%2C%20Calle%20Mayor%2012%2C%20Valencia')
    expect(directionsUrl(clinic, null)).toContain('google.com/maps')
  })
  it('offers nothing without an address', () => {
    expect(directionsUrl({ ...clinic, address: '  ' }, 'ios')).toBeNull()
  })
})

describe('calling the clinic', () => {
  it('keeps only what a dialler reads', () => {
    expect(telUrl('+34 961 23 45 67')).toBe('tel:+34961234567')
    expect(telUrl('(96) 123-45-67')).toBe('tel:961234567')
  })
  it('offers nothing for an empty or too-short number', () => {
    expect(telUrl(null)).toBeNull()
    expect(telUrl('12')).toBeNull()
  })
})

describe('which maps app a device has', () => {
  it('trusts the native platform in the app', () => {
    expect(devicePlatform({ Capacitor: { getPlatform: () => 'android' }, navigator: { userAgent: 'iPhone' } })).toBe('android')
  })
  it('reads Safari on an iPhone, and an iPad that calls itself a Mac', () => {
    expect(devicePlatform({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } })).toBe('ios')
    expect(devicePlatform({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 } })).toBe('ios')
    expect(devicePlatform({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 } })).toBe('web')
  })
})
