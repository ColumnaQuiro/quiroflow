export const COUNTRIES = [
  { code: 'ES', flag: '🇪🇸', name: 'Spain', dial: '+34' },
  { code: 'PT', flag: '🇵🇹', name: 'Portugal', dial: '+351' },
  { code: 'FR', flag: '🇫🇷', name: 'France', dial: '+33' },
  { code: 'GB', flag: '🇬🇧', name: 'United Kingdom', dial: '+44' },
  { code: 'US', flag: '🇺🇸', name: 'United States', dial: '+1' },
  { code: 'DE', flag: '🇩🇪', name: 'Germany', dial: '+49' },
  { code: 'IT', flag: '🇮🇹', name: 'Italy', dial: '+39' },
]

export function countryByCode(code: string) {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0]
}
