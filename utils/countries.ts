// Dial codes for the countries a clinic's patients actually come from.
//
// This list used to hold seven countries, and countryByCode() answered
// "Spain" for everything else. That is not a harmless default: a Belgian
// number stored against 'BE' rendered as "+34 478 956 575", a real number
// belonging to someone else. The PracticeHub import made 90 of those in one
// pass (see components/import/PracticeHubPatientsImporter.vue), across 16
// countries this list had never heard of.
//
// So the rule now is: an unknown code is shown as unknown, never as Spain.
// countryByCode() returns a dial-less entry for anything not listed, and
// formatPhoneDisplay() prints such a number bare rather than inventing a
// prefix for it.
//
// Order matters in two places. Spain first, because it is the default for a
// new number typed by this clinic's reception. And among the +1 countries,
// US before CA, because splitDialPrefix() resolves a tie by list order and
// "+1..." has always resolved to US.
export interface Country {
  code: string
  flag: string
  name: string
  dial: string
}

// Flags are derived, not typed out: a flag emoji is just the country's two
// letters as regional-indicator code points, so there is no second list to
// keep in step with this one.
function flagOf(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

const NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

function country(code: string, dial: string): Country {
  return { code, flag: flagOf(code), name: NAMES.of(code) ?? code, dial }
}

export const COUNTRIES: Country[] = [
  country('ES', '+34'),
  // Europe
  country('AD', '+376'), country('AL', '+355'), country('AT', '+43'), country('BA', '+387'),
  country('BE', '+32'), country('BG', '+359'), country('BY', '+375'), country('CH', '+41'),
  country('CY', '+357'), country('CZ', '+420'), country('DE', '+49'), country('DK', '+45'),
  country('EE', '+372'), country('FI', '+358'), country('FR', '+33'), country('GB', '+44'),
  country('GI', '+350'), country('GR', '+30'), country('HR', '+385'), country('HU', '+36'),
  country('IE', '+353'), country('IS', '+354'), country('IT', '+39'), country('LI', '+423'),
  country('LT', '+370'), country('LU', '+352'), country('LV', '+371'), country('MC', '+377'),
  country('MD', '+373'), country('ME', '+382'), country('MK', '+389'), country('MT', '+356'),
  country('NL', '+31'), country('NO', '+47'), country('PL', '+48'), country('PT', '+351'),
  country('RO', '+40'), country('RS', '+381'), country('RU', '+7'), country('SE', '+46'),
  country('SI', '+386'), country('SK', '+421'), country('SM', '+378'), country('TR', '+90'),
  country('UA', '+380'),
  // Americas -- US before CA, see the note above.
  country('US', '+1'), country('CA', '+1'),
  country('AR', '+54'), country('BO', '+591'), country('BR', '+55'), country('CL', '+56'),
  country('CO', '+57'), country('CR', '+506'), country('CU', '+53'), country('DO', '+1'),
  country('EC', '+593'), country('GT', '+502'), country('HN', '+504'), country('MX', '+52'),
  country('NI', '+505'), country('PA', '+507'), country('PE', '+51'), country('PR', '+1'),
  country('PY', '+595'), country('SV', '+503'), country('UY', '+598'), country('VE', '+58'),
  // Africa and the Middle East
  country('AE', '+971'), country('DZ', '+213'), country('EG', '+20'), country('IL', '+972'),
  country('KE', '+254'), country('MA', '+212'), country('NG', '+234'), country('QA', '+974'),
  country('SA', '+966'), country('TN', '+216'), country('ZA', '+27'),
  // Asia and Oceania
  country('AU', '+61'), country('CN', '+86'), country('HK', '+852'), country('ID', '+62'),
  country('IN', '+91'), country('JP', '+81'), country('KR', '+82'), country('MY', '+60'),
  country('NZ', '+64'), country('PH', '+63'), country('SG', '+65'), country('TH', '+66'),
  country('VN', '+84'),
]

// Everything after Spain, sorted by name -- for a dropdown, where a list in
// definition order reads as random.
export const COUNTRIES_BY_NAME: Country[] = [
  COUNTRIES[0],
  ...COUNTRIES.slice(1).sort((a, b) => a.name.localeCompare(b.name)),
]

// An unlisted code keeps its own identity instead of borrowing Spain's. The
// empty dial is what tells formatPhoneDisplay() it has no prefix to add.
export function countryByCode(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) ?? { code, flag: '🏳️', name: code, dial: '' }
}
