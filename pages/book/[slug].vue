<script setup lang="ts">
import { COUNTRIES_BY_NAME } from '~/utils/countries'
import { looksLikePhoneNumber } from '~/utils/phone'
import { effectiveDuration, effectivePriceCents, type AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { practitionerWindowsForDay } from '~/utils/businessHours'
import { bookingSlotsForDay, bookingWindowsFor, calendarDateKey, clinicHourOf, clinicTimeLabel } from '~/utils/bookingSlots'
import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { BOOKING_LANGUAGES, bookingLanguageFromAcceptLanguage, bookingLanguageFromList, bookingLanguageOfTag, type BookingLanguage } from '~/utils/bookingLanguage'

definePageMeta({ layout: false })

interface BookingClinic {
  id: string
  name: string
  address: string | null
  phone?: string | null
  email?: string | null
  business_hours: Record<string, [string, string][]>
  logo_storage_path: string | null
  // The zone business_hours are written in. Absent before 20260930141539.
  timezone?: string | null
}
interface BookingAppointmentType {
  id: string
  name: string
  duration_minutes: number
  color: string
  default_price_cents: number
  online_payment_required: boolean
  online_bookable_by: 'all' | 'new_patients' | 'existing_patients'
  online_bypass_practitioner: boolean
  online_max_days_ahead: number | null
  online_deposit_cents: number | null
  /** Only these practitioners do it; empty (or absent, before 20261026141816) for everyone. */
  practitioner_ids?: string[]
}
interface BookingTeamMember {
  id: string
  full_name: string
  color: string
  clinic_ids: string[]
  business_hours: Record<string, [string, string][]> | null
  photo_storage_path: string | null
}
interface BookingInfo {
  account: {
    id: string
    name: string
    appointment_confirmation_enabled: boolean
    appointment_confirmation_channels: string[]
    online_booking_max_days_ahead: number
    online_booking_gtm_id: string | null
    online_booking_success_url: string | null
    online_booking_primary_color: string | null
    online_booking_secondary_color: string | null
    online_booking_background_color: string | null
    online_booking_hide_logo: boolean
    online_booking_text_overrides: Record<string, string>
    discount_codes_enabled: boolean
    default_phone_country: string | null
  }
  clinics: BookingClinic[]
  appointment_types: BookingAppointmentType[]
  team_members: BookingTeamMember[]
  overrides: AppointmentTypeOverride[]
}

const route = useRoute()
const slug = route.params.slug as string
const supabase = useSupabaseClient()

// --- the page's language ---
//
// Spanish, English or French: ?lang= first (the link a clinic sends its
// English- or French-speaking patients), then the browser's language, then
// Spanish. The language a patient books in is kept as their
// preferred_language (book.post.ts), which is what the WhatsApp templates
// after the booking are chosen by.
//
// The server renders in it from Accept-Language, and the CDN copy of the page
// (the '/book/**' rule in nuxt.config.ts) is kept per language as well as per
// URL, by Netlify-Vary. Netlify's choice of copy and ours are the same rule
// (utils/bookingLanguage.ts), and the browser re-reads navigator.languages on
// mount anyway, so a copy that was ever served to the wrong visitor corrects
// itself rather than staying wrong.
const queryLang = typeof route.query.lang === 'string' ? bookingLanguageOfTag(route.query.lang) : null
const { lang, locale, say } = useBookingLang()
if (import.meta.server) {
  lang.value = queryLang ?? bookingLanguageFromAcceptLanguage(useRequestHeader('accept-language'))
  useResponseHeader('Netlify-Vary').value = 'query,language=es|en|fr'
}
useHead({ htmlAttrs: { lang } })
const LANGUAGE_NAMES: Record<BookingLanguage, string> = { es: 'Español', en: 'English', fr: 'Français' }
function chooseLanguage(next: BookingLanguage) {
  lang.value = next
  // Kept in the address, so a reload, or the link copied from the bar, stays
  // in the language chosen.
  const url = new URL(window.location.href)
  url.searchParams.set('lang', next)
  window.history.replaceState(window.history.state, '', url)
}

const phase = ref<'loading' | 'not_found' | 'select' | 'datetime' | 'details' | 'payment' | 'card' | 'success'>('loading')
// False in the server's HTML and in the first client render, true once the
// page is interactive. The steps are server-rendered with their buttons in
// place (see the bottom of this script), and a tap before hydration would
// otherwise land on a button with no listener yet and be lost; disabled
// until then says so, and keeps a test runner's first click honest.
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
})

// The clinic's fees for a late cancellation or a missed visit, said before
// anyone books, and whether it asks for a card to hold the booking
// (get_public_booking_policy). With a card asked for, book.post.ts returns a
// link to Stripe's own card page, offered as the step after booking.
const policy = ref<{ card_on_file: boolean; cancellation_fee_cents: number | null; missed_appointment_fee_cents: number | null; notice_hours: number } | null>(null)
const cardUrl = ref<string | null>(null)
function openCardPage() {
  if (!cardUrl.value) return
  // Stripe's page will not load inside a frame: an embedded booking widget
  // opens it in a tab of its own.
  if (window.self !== window.top) window.open(cardUrl.value, '_blank', 'noopener')
  else window.location.href = cardUrl.value
}

const info = ref<BookingInfo | null>(null)
const clinicId = ref('')
const appointmentTypeId = ref('')
const teamMemberId = ref('')
// True once a valid ?type= deep-link has forced the appointment type -- a
// marketing page linking to one specific offer (e.g. a promo's discounted
// first visit) shouldn't let the patient switch to some other, unrelated
// service from the dropdown.
const typeLockedByQuery = ref(false)
// Sentinel teamMemberId meaning "let the patient skip picking a specific
// practitioner" -- distinct from bypassPractitioner below (an admin-forced
// auto-pick with no UI at all). Resolved to a real member id the moment a
// slot is picked in pickSlot(), so nothing downstream (summary, submit,
// success screen) ever needs to know this mode existed.
const ANY_PRACTITIONER = '__any__'

const clinic = computed(() => info.value?.clinics.find((c) => c.id === clinicId.value) ?? null)
const appointmentType = computed(() => info.value?.appointment_types.find((t) => t.id === appointmentTypeId.value) ?? null)
const teamMember = computed(() => info.value?.team_members.find((m) => m.id === teamMemberId.value) ?? null)
// At the clinic chosen, and doing the type chosen when only some do it.
const availablePractitioners = computed(() => {
  const only = appointmentType.value?.practitioner_ids ?? []
  return (info.value?.team_members ?? []).filter((m) => m.clinic_ids.includes(clinicId.value) && (only.length === 0 || only.includes(m.id)))
})
const anyPractitionerMode = computed(() => teamMemberId.value === ANY_PRACTITIONER)
// Every time on this page is the clinic's. Slots used to be built with
// setHours -- the VISITOR's zone -- so anyone booking from outside the
// clinic's zone was offered, and booked, hours shifted by the difference.
const clinicTimeZone = computed(() => clinic.value?.timezone || DEFAULT_CLINIC_TIMEZONE)

function practitionerInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}
function practitionerPhotoUrl(member: BookingTeamMember) {
  if (!member.photo_storage_path) return null
  return supabase.storage.from('team-member-photos').getPublicUrl(member.photo_storage_path).data.publicUrl
}
// Sunday first, as Date.getDay() counts.
const WEEKDAY_FULL: Record<BookingLanguage, string[]> = {
  es: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
}
function practitionerAvailabilityLabel(member: BookingTeamMember) {
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const clinicWindows = clinic.value?.business_hours?.[WEEKDAY_KEYS[i]] ?? []
    if (practitionerWindowsForDay(clinicWindows, member.business_hours, WEEKDAY_KEYS[i]).length > 0) days.push(WEEKDAY_FULL[lang.value][i])
  }
  if (days.length === 0) return say({ es: 'Sin disponibilidad', en: 'No availability', fr: 'Aucune disponibilité' })
  // "Lunes, Martes y Jueves" / "Monday, Tuesday and Thursday": the language's
  // own list, conjunction included.
  const list = new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }).format(days)
  return say({ es: `Disponible ${list}`, en: `Available ${list}`, fr: `Disponible ${list}` })
}
function chooseTeamMember(id: string) {
  teamMemberId.value = id
  proceedToDatetime()
}

const stepNumber = computed(() => (phase.value === 'select' ? 1 : phase.value === 'datetime' ? 2 : phase.value === 'details' ? 3 : 0))
const stepTitle = computed(() => {
  if (phase.value === 'select') return t('select_heading', { es: 'Elija un profesional', en: 'Choose a practitioner', fr: 'Choisissez un praticien' })
  if (phase.value === 'datetime') return t('choose_datetime', { es: 'Elija su fecha y hora', en: 'Choose your date and time', fr: 'Choisissez la date et l’heure' })
  if (phase.value === 'details') return t('enter_details', { es: 'Introduzca sus datos', en: 'Enter your details', fr: 'Saisissez vos coordonnées' })
  return ''
})

const effectiveDurationMinutes = computed(() =>
  appointmentType.value
    ? effectiveDuration(appointmentType.value.duration_minutes, appointmentTypeId.value, teamMemberId.value, info.value?.overrides ?? [])
    : 0,
)
const effectivePrice = computed(() =>
  appointmentType.value
    ? effectivePriceCents(appointmentType.value.default_price_cents, appointmentTypeId.value, teamMemberId.value, info.value?.overrides ?? [])
    : 0,
)

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString(locale.value, { style: 'currency', currency: 'EUR' })
}

// Overrides the theme's brand color CSS vars for just this page's root
// element -- every bg-brand/text-brand-text/hover:bg-brand-tint class already
// on this page picks it up for free, same rgb-triplet convention theme.css
// uses (see tailwind.config.ts's themeColor()).
function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
const brandStyle = computed(() => {
  const style: Record<string, string> = {}
  const primary = info.value?.account.online_booking_primary_color ? hexToRgbTriplet(info.value.account.online_booking_primary_color) : null
  const secondary = info.value?.account.online_booking_secondary_color ? hexToRgbTriplet(info.value.account.online_booking_secondary_color) : null
  const background = info.value?.account.online_booking_background_color ? hexToRgbTriplet(info.value.account.online_booking_background_color) : null
  if (primary) {
    style['--color-brand'] = primary
    style['--color-brand-hover'] = primary
    style['--color-brand-text'] = primary
  }
  if (secondary) style['--color-brand-tint'] = secondary
  // Overrides the page's own background -- separate from the brand accent
  // colors above, this is what actually shows through around the card when
  // the widget is embedded (e.g. to match a marketing site's own tone).
  if (background) style['--color-surface-page'] = background
  return style
})

// The clinic's own wording for a few of the page's strings (Settings >
// Online Booking), which is written in Spanish against Spanish defaults --
// so it replaces the Spanish only. A patient reading in English or French
// gets the page's translation rather than one Spanish sentence among them.
function t(key: string, text: Record<BookingLanguage, string>) {
  const override = lang.value === 'es' ? info.value?.account.online_booking_text_overrides?.[key] : null
  return override || say(text)
}

// create_public_booking's refusals are English sentences, which the page used
// to show as they were -- to Spanish patients too. Each is said here in the
// page's language; one not listed is still shown as the function wrote it.
const BOOKING_REFUSALS: Record<string, Record<BookingLanguage, string>> = {
  'An email address is required to book': { es: 'Indique su correo electrónico.', en: 'Please enter your email address.', fr: 'Veuillez indiquer votre adresse e-mail.' },
  'Email required': { es: 'Indique su correo electrónico.', en: 'Please enter your email address.', fr: 'Veuillez indiquer votre adresse e-mail.' },
  'A phone number is required to book': { es: 'Indique su número de móvil.', en: 'Please enter your mobile number.', fr: 'Veuillez indiquer votre numéro de portable.' },
  'That phone number does not look right': { es: 'Ese número no parece correcto. Revíselo, por favor.', en: 'That number does not look right. Please check it.', fr: 'Ce numéro ne semble pas correct. Veuillez le vérifier.' },
  'First name required': { es: 'Indique su nombre.', en: 'Please enter your first name.', fr: 'Veuillez indiquer votre prénom.' },
  'That time is no longer available': { es: 'Esa hora ya no está disponible. Elija otra, por favor.', en: 'That time is no longer available. Please choose another.', fr: 'Ce créneau n’est plus disponible. Veuillez en choisir un autre.' },
  'Cannot book a time in the past': { es: 'Esa hora ya ha pasado. Elija otra, por favor.', en: 'That time has already passed. Please choose another.', fr: 'Ce créneau est déjà passé. Veuillez en choisir un autre.' },
  'That date is too far in advance to book online': { es: 'Esa fecha está demasiado lejos para reservar online.', en: 'That date is too far ahead to book online.', fr: 'Cette date est trop éloignée pour réserver en ligne.' },
  'That class is not on at that time': { es: 'Esa clase no se imparte a esa hora.', en: 'That class is not on at that time.', fr: 'Ce cours n’a pas lieu à cette heure-là.' },
  'This appointment type is only available to new patients': { es: 'Este servicio solo pueden reservarlo pacientes nuevos.', en: 'This service can only be booked by new patients.', fr: 'Ce service est réservé aux nouveaux patients.' },
  'This appointment type is only available to existing patients': { es: 'Este servicio solo pueden reservarlo pacientes de la clínica. Llame a la clínica si ya es paciente.', en: 'This service can only be booked by existing patients. Please call the clinic if you already are one.', fr: 'Ce service est réservé aux patients du cabinet. Appelez le cabinet si vous l’êtes déjà.' },
  'Invalid or expired discount code': { es: 'El código de descuento no es válido o ha caducado.', en: 'That discount code is not valid or has expired.', fr: 'Ce code de réduction n’est pas valide ou a expiré.' },
  'This discount code has reached its usage limit': { es: 'Ese código de descuento ya no puede usarse más.', en: 'That discount code has reached its usage limit.', fr: 'Ce code de réduction a atteint sa limite d’utilisation.' },
  'Practitioner not available': { es: 'Ese profesional ya no está disponible. Elija otra hora, por favor.', en: 'That practitioner is no longer available. Please choose another time.', fr: 'Ce praticien n’est plus disponible. Veuillez choisir un autre créneau.' },
  'Appointment type not available': { es: 'Ese servicio ya no se puede reservar online.', en: 'That service can no longer be booked online.', fr: 'Ce service ne peut plus être réservé en ligne.' },
  'Clinic not available for online booking': { es: 'Esta clínica no acepta reservas online ahora mismo.', en: 'This clinic is not taking online bookings right now.', fr: 'Ce cabinet n’accepte pas de réservations en ligne pour le moment.' },
}
function bookingRefusal(message: string | undefined) {
  if (!message) return say({ es: 'No se ha podido completar la reserva. Inténtelo de nuevo, por favor.', en: 'The booking could not be completed. Please try again.', fr: 'La réservation n’a pas pu aboutir. Veuillez réessayer.' })
  const known = BOOKING_REFUSALS[message] ?? Object.entries(BOOKING_REFUSALS).find(([english]) => message.startsWith(english))?.[1]
  return known ? say(known) : message
}

// Gift vouchers: gift-check.post.ts and book.post.ts name why a code cannot be
// used (GIFT_REFUSAL's reasons), and the page says it.
const GIFT_REFUSALS: Record<string, Record<BookingLanguage, string>> = {
  unknown: { es: 'Ese código no existe.', en: 'That code does not exist.', fr: 'Ce code n’existe pas.' },
  unpaid: { es: 'Ese bono regalo aún no está pagado.', en: 'That gift voucher has not been paid for yet.', fr: 'Ce bon cadeau n’a pas encore été payé.' },
  redeemed: { es: 'Ese bono regalo ya se ha canjeado.', en: 'That gift voucher has already been redeemed.', fr: 'Ce bon cadeau a déjà été utilisé.' },
  expired: { es: 'Ese bono regalo ha caducado.', en: 'That gift voucher has expired.', fr: 'Ce bon cadeau a expiré.' },
}
function giftRefusal(gift: { reason?: string; message?: string }) {
  const known = gift.reason ? GIFT_REFUSALS[gift.reason] : undefined
  if (known) return say(known)
  return lang.value === 'es' && gift.message
    ? gift.message
    : say({ es: 'No se ha podido canjear el bono regalo. Dalo en recepción.', en: 'The gift voucher could not be redeemed. Please hand it in at reception.', fr: 'Le bon cadeau n’a pas pu être utilisé. Présentez-le à l’accueil.' })
}
function giftDescription(gift: GiftCheck) {
  if (gift.kind === 'package') {
    return say({ es: `${gift.label}, para usar en tus próximas visitas`, en: `${gift.label}, to use on your next visits`, fr: `${gift.label}, à utiliser lors de vos prochaines visites` })
  }
  const cents = gift.valueCents ?? 0
  return say({
    es: `${(cents / 100).toLocaleString('es-ES')} € de saldo para usar en la clínica`,
    en: `${formatPrice(cents)} of credit to use at the clinic`,
    fr: `${formatPrice(cents)} de crédit à utiliser au cabinet`,
  })
}

// Public bucket (0096_clinic_logo.sql) -- getPublicUrl is a pure local URL
// computation, no network round trip, so this is safe to compute per-render.
const clinicLogoUrl = computed(() => {
  if (info.value?.account.online_booking_hide_logo) return null
  const path = clinic.value?.logo_storage_path
  return path ? supabase.storage.from('clinic-logos').getPublicUrl(path).data.publicUrl : null
})

// --- where this visit came from ---
//
// Captured once on mount, not read at submit time: document.referrer is only
// the real referrer on the first paint, and a patient who steps through the
// flow (or reloads after picking a slot) would otherwise lose it. The query
// string survives the phase changes because this page never navigates, but
// snapshotting both together keeps the two halves consistent.
//
// Sent after the booking exists, never before -- this is marketing data, and
// nothing about it should be able to fail a booking.
// `ref` is a patient's referral link (server/utils/bookingReferral.ts).
const ATTRIBUTION_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'msclkid', 'ref']
const visitAttribution = ref<{ params: Record<string, string>; referrer: string; landingPath: string } | null>(null)

function captureAttribution() {
  // Keys are matched after trimming and lowercasing, because hand-built ad
  // URLs routinely are not clean. The live Meta ad points at
  // `…?+utm_campaign=ad_imagen&utm_medium=ad&utm_source=Facebook` -- that `+`
  // straight after the `?` decodes to a space, so the parameter is really
  // named " utm_campaign" and `searchParams.get('utm_campaign')` returns
  // null. Analytics silently loses the campaign; there is no reason for this
  // to lose it too over a stray character nobody can see.
  const normalised = new Map<string, string>()
  for (const key of Object.keys(route.query)) {
    const value = route.query[key]
    if (typeof value === 'string' && value.trim()) normalised.set(key.trim().toLowerCase(), value.trim())
  }

  const params: Record<string, string> = {}
  for (const key of ATTRIBUTION_PARAMS) {
    const value = normalised.get(key)
    if (value) params[key] = value
  }
  // Same-origin referrers are the patient moving between steps, not where
  // they came from -- recording those would make every booking look
  // self-referred.
  let referrer = ''
  try {
    if (document.referrer && new URL(document.referrer).host !== window.location.host) referrer = document.referrer
  } catch {
    referrer = ''
  }
  visitAttribution.value = { params, referrer, landingPath: window.location.pathname + window.location.search }
}

// --- discount code (validated server-side at submit, in create_public_booking) ---
const discountCode = ref('')
const discountAppliedCents = ref(0)

// --- gift voucher ("Tengo un bono regalo") ---
// Checked here before booking (gift-check.post.ts) and redeemed by the
// booking itself (book.post.ts), onto whoever the booking is for. ?regalo=
// carries the code from the voucher's own email.
const giftOpen = ref(typeof route.query.regalo === 'string')
const giftOffered = ref(typeof route.query.regalo === 'string')
const giftCode = ref(typeof route.query.regalo === 'string' ? route.query.regalo : '')
type GiftCheck = { ok: boolean; label?: string; kind?: string; valueCents?: number; description?: string; message?: string; reason?: string }
const giftChecked = ref<GiftCheck | null>(null)
const checkingGift = ref(false)
const giftResult = ref<{ redeemed: boolean; label?: string; message?: string; reason?: string } | null>(null)
async function checkGift() {
  if (!giftCode.value.trim()) return
  checkingGift.value = true
  try {
    giftChecked.value = await $fetch<GiftCheck>('/api/public-booking/gift-check', { method: 'POST', body: { slug, code: giftCode.value } })
  } catch {
    giftChecked.value = { ok: false, message: say({ es: 'No se ha podido comprobar el código.', en: 'The code could not be checked.', fr: 'Le code n’a pas pu être vérifié.' }) }
  } finally {
    checkingGift.value = false
  }
}
onMounted(async () => {
  try {
    const o = await $fetch<{ enabled: boolean }>('/api/public-booking/gift-options', { query: { slug } })
    if (o.enabled) giftOffered.value = true
  } catch {
    // Nothing to offer is the same as not selling them.
  }
  if (giftCode.value) checkGift()
})

// Restore whatever theme the visitor actually had if they navigate away
// within the same session (only relevant when staff preview this page from
// inside the authenticated app) -- setPreference re-resolves and re-applies
// the stored preference, same as it does on a normal toggle.
onUnmounted(() => {
  const { preference, setPreference } = useTheme()
  setPreference(preference.value)
})

function onClinicChange() {
  const forClinic = availablePractitioners.value
  teamMemberId.value = forClinic.length === 1 || bypassPractitioner.value ? (forClinic[0]?.id ?? '') : ''
}

// "Bypass practitioner selection" shows any available practitioner rather
// than asking the patient to pick one: "any" is "the first one offering
// this clinic and this type", same one-practitioner auto-pick the page
// already did before this feature existed.
const bypassPractitioner = computed(() => !!appointmentType.value?.online_bypass_practitioner)
watch(appointmentTypeId, () => {
  if (bypassPractitioner.value) teamMemberId.value = availablePractitioners.value[0]?.id ?? ''
  // Someone picked before the type who does not do it is no longer a choice.
  else if (teamMemberId.value && teamMemberId.value !== ANY_PRACTITIONER && !availablePractitioners.value.some((m) => m.id === teamMemberId.value)) teamMemberId.value = ''
})

// --- group classes ---
// A type with places (appointment_types.class_capacity) is booked into one of
// its sessions, which the clinic puts on: the page lists them with the
// places left (get_public_class_sessions) instead of asking for a
// practitioner and offering free times. Full ones are shown, not offered.
interface ClassSessionOption { id: string; starts_at: string; ends_at: string; practitioner_id: string; practitioner_name: string; room_name: string | null; places_left: number }
const classInfo = ref<{ is_class: boolean; sessions: ClassSessionOption[] } | null>(null)
const isClass = computed(() => !!classInfo.value?.is_class)
let classToken = 0
watch([appointmentTypeId, clinicId], async ([typeId, cId]) => {
  const mine = ++classToken
  classInfo.value = null
  if (!typeId || !cId) return
  const { data } = await supabase.rpc('get_public_class_sessions', { p_slug: slug, p_clinic_id: cId, p_appointment_type_id: typeId })
  if (mine === classToken) classInfo.value = (data as unknown as { is_class: boolean; sessions: ClassSessionOption[] } | null) ?? { is_class: false, sessions: [] }
}, { immediate: true })
function pickClassSession(session: ClassSessionOption) {
  if (session.places_left <= 0) {
    waitlistFor.value = session
    waitlistPosition.value = null
    waitlistError.value = ''
    return
  }
  waitlistFor.value = null
  teamMemberId.value = session.practitioner_id
  selectedSlot.value = new Date(session.starts_at)
  phase.value = 'details'
}
// A full class: the patient's name and how to reach them, and they join its
// waitlist (join_public_class_waitlist). If a place is cancelled the clinic's
// waitlist automation sends them a link to take it.
const waitlistFor = ref<ClassSessionOption | null>(null)
const waitlistPosition = ref<number | null>(null)
const waitlistError = ref('')
const joiningWaitlist = ref(false)
const WAITLIST_REFUSALS: Record<string, Record<BookingLanguage, string>> = {
  'That phone number does not look right': { es: 'Ese número no parece correcto. Revíselo, por favor.', en: 'That number does not look right. Please check it.', fr: 'Ce numéro ne semble pas correct. Veuillez le vérifier.' },
  'An email address is required': { es: 'Indique su correo electrónico.', en: 'Please enter your email address.', fr: 'Veuillez indiquer votre adresse e-mail.' },
  'A phone number is required': { es: 'Indique su número de móvil.', en: 'Please enter your mobile number.', fr: 'Veuillez indiquer votre numéro de portable.' },
  'First name required': { es: 'Indique su nombre.', en: 'Please enter your first name.', fr: 'Veuillez indiquer votre prénom.' },
  'You already have a place in this class': { es: 'Ya tiene plaza en esta clase.', en: 'You already have a place in this class.', fr: 'Vous avez déjà une place dans ce cours.' },
  'That class still has places: book one': { es: 'Se ha liberado una plaza: puede reservarla.', en: 'A place has come free: you can book it.', fr: 'Une place s’est libérée : vous pouvez la réserver.' },
}
async function joinWaitlist() {
  if (!waitlistFor.value) return
  waitlistError.value = ''
  phoneChecked.value = true
  if (!firstName.value.trim() || !email.value.trim() || !looksLikePhoneNumber(phoneNumber.value, dialCode.value)) {
    waitlistError.value = say({ es: 'Indique su nombre, correo y un móvil válido.', en: 'Please enter your name, email and a valid mobile number.', fr: 'Veuillez indiquer votre nom, votre e-mail et un numéro de portable valide.' })
    return
  }
  joiningWaitlist.value = true
  const { data, error } = await supabase.rpc('join_public_class_waitlist', {
    p_slug: slug,
    p_session_id: waitlistFor.value.id,
    p_first_name: firstName.value,
    p_last_name: lastName.value,
    p_email: email.value,
    p_phone: phoneNumber.value,
    p_country_code: dialCode.value,
  })
  joiningWaitlist.value = false
  if (error) {
    const known = WAITLIST_REFUSALS[error.message]
    waitlistError.value = known ? say(known) : say({ es: 'No se ha podido apuntar. Inténtelo de nuevo o llame a la clínica.', en: 'You could not be added. Please try again or call the clinic.', fr: 'L’inscription n’a pas pu être faite. Veuillez réessayer ou appeler le cabinet.' })
    return
  }
  waitlistPosition.value = (data as { position: number } | null)?.position ?? null
}
function classSessionLabel(session: ClassSessionOption) {
  const d = new Date(session.starts_at)
  const day = d.toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'short', timeZone: clinicTimeZone.value })
  const time = d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: clinicTimeZone.value })
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`
}

const canContinueFromSelect = computed(() => !!clinicId.value && !!appointmentTypeId.value && (!!teamMemberId.value || isClass.value))
const showPractitionerCards = computed(() => !isClass.value && !bypassPractitioner.value && availablePractitioners.value.length > 1)
// Covers picking a service (from the dropdown) that resolves down to a
// single practitioner after the page already mounted -- the onMounted skip
// above only covers what's known at load time.
watch(canContinueFromSelect, (can) => {
  if (can && phase.value === 'select' && !showPractitionerCards.value) proceedToDatetime()
})

// --- date/time ---
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
// Monday first, as the grid is laid out.
const WEEKDAY_LABELS: Record<BookingLanguage, string[]> = {
  es: ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  fr: ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'],
}

const viewMonth = ref(startOfMonth(new Date()))
const selectedDate = ref<Date | null>(null)
const selectedSlot = ref<Date | null>(null)
// Keyed by team_member_id -- covers every practitioner being checked, since
// anyPractitionerMode needs all of them and the single-practitioner path is
// just a map with one entry. Loaded for the whole visible 42-day grid at
// once (see loadMonthAvailability) so the calendar can grey out a day with
// no free slot left without a fetch per day.
const monthBusyByMember = ref<Record<string, { starts_at: string; ends_at: string }[]>>({})
// Blocked time isn't practitioner-specific (availability_blocks has no
// practitioner column, only an optional room), and the widget never lets a
// patient pick a room -- so any block for the clinic counts as unavailable
// for every practitioner rather than risk double-booking whichever room
// turns out to be assigned.
const monthBlocked = ref<{ starts_at: string; ends_at: string; practitioner_id: string | null }[]>([])
// A block with no practitioner_id applies to everyone (matches the staff
// calendar's "whole clinic" block); one with a specific practitioner_id
// only counts as busy for that practitioner.
function blocksForMember(memberId: string) {
  return monthBlocked.value.filter((b) => b.practitioner_id === null || b.practitioner_id === memberId)
}
const monthAvailabilityLoading = ref(false)
const monthAvailabilityLoaded = ref(false)

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
// Calendar cells are compared as the clinic's dates ("2026-10-05"): a cell
// stands for a day at the clinic, whatever day it is where the visitor is.
const clinicToday = computed(() => clinicDateOf(new Date(), clinicTimeZone.value))

const monthLabel = computed(() =>
  viewMonth.value.toLocaleDateString(locale.value, { month: 'short', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase())
)

// Per-type override falls back to the account default, same convention as
// every other appointment_type_overrides-style field in this app.
// create_public_booking refuses a start later than now + that many days, so
// that instant is also the last slot offered.
const latestStart = computed(() => {
  const days = appointmentType.value?.online_max_days_ahead ?? info.value?.account.online_booking_max_days_ahead ?? 90
  return new Date(Date.now() + days * 86400000)
})
const lastBookableDate = computed(() => clinicDateOf(latestStart.value, clinicTimeZone.value))

const gridRange = computed(() => {
  const first = viewMonth.value
  const firstWeekday = (first.getDay() + 6) % 7 // Monday = 0
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - firstWeekday)
  const gridEnd = new Date(gridStart)
  gridEnd.setDate(gridStart.getDate() + 42)
  return { gridStart, gridEnd }
})

const calendarDays = computed(() => {
  const { gridStart } = gridRange.value
  const days: { date: Date; inMonth: boolean; bookable: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + i)
    const key = calendarDateKey(date)
    const inRange = key >= clinicToday.value && key <= lastBookableDate.value
    days.push({
      date,
      inMonth: date.getMonth() === viewMonth.value.getMonth(),
      bookable: inRange && dayHasHours(date) && dayHasAvailability(date),
    })
  }
  return days
})

function dayHasHours(date: Date) {
  const hours = clinic.value?.business_hours
  if (!hours) return false
  const key = calendarDateKey(date)
  if (anyPractitionerMode.value) {
    return availablePractitioners.value.some((m) => bookingWindowsFor(key, hours, m.business_hours).length > 0)
  }
  return bookingWindowsFor(key, hours, teamMember.value?.business_hours).length > 0
}

function prevMonth() {
  viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() - 1, 1)
  loadMonthAvailability()
}
function nextMonth() {
  viewMonth.value = new Date(viewMonth.value.getFullYear(), viewMonth.value.getMonth() + 1, 1)
  loadMonthAvailability()
}

// Busy/blocked times for the whole visible grid are already loaded (see
// loadMonthAvailability), so picking a day is just a local state change --
// no per-day fetch, and the day was never clickable unless dayHasAvailability
// already found it a free slot.
function selectDate(day: { date: Date; bookable: boolean }) {
  if (!day.bookable) return
  selectedDate.value = day.date
  selectedSlot.value = null
}

async function loadMonthAvailability() {
  // The browser's job, never the server's: busy and blocked times change by
  // the minute, and the server's HTML is cached (see '/book/**' in
  // nuxt.config.ts), so a copy taken there would offer a slot somebody has
  // just booked. The grid renders every in-range day as bookable until this
  // has answered, on both sides alike.
  if (import.meta.server) return
  if (!clinicId.value) return
  monthAvailabilityLoading.value = true
  monthAvailabilityLoaded.value = false
  const { gridStart, gridEnd } = gridRange.value
  // A day either side: the grid's edges are the visitor's midnights, and the
  // clinic's first and last days can start or end outside them.
  const fromIso = new Date(gridStart.getTime() - 86400000).toISOString()
  const toIso = new Date(gridEnd.getTime() + 86400000).toISOString()
  const memberIds = anyPractitionerMode.value ? availablePractitioners.value.map((m) => m.id) : teamMemberId.value ? [teamMemberId.value] : []
  const [busyEntries, blockedResult] = await Promise.all([
    Promise.all(
      memberIds.map(async (id) => {
        const { data } = await supabase.rpc('get_booking_busy_times', {
          p_clinic_id: clinicId.value,
          p_team_member_id: id,
          p_from: fromIso,
          p_to: toIso,
        })
        return [id, (data as { starts_at: string; ends_at: string }[]) ?? []] as const
      }),
    ),
    supabase.rpc('get_booking_blocked_times', { p_clinic_id: clinicId.value, p_from: fromIso, p_to: toIso }),
  ])
  monthBusyByMember.value = Object.fromEntries(busyEntries)
  monthBlocked.value = (blockedResult.data as { starts_at: string; ends_at: string; practitioner_id: string | null }[]) ?? []
  monthAvailabilityLoading.value = false
  monthAvailabilityLoaded.value = true
}

interface DaySlot {
  time: Date
  memberId: string
}

// The cell's date as the clinic's date, its hours read on the clinic's clock
// -- utils/bookingSlots.ts, shared with the patient app.
function slotsForMember(
  date: Date,
  memberBusinessHours: Record<string, [string, string][]> | null | undefined,
  busy: { starts_at: string; ends_at: string }[],
): Date[] {
  return bookingSlotsForDay({
    date: calendarDateKey(date),
    timeZone: clinicTimeZone.value,
    clinicHours: clinic.value?.business_hours,
    practitionerHours: memberBusinessHours,
    durationMinutes: effectiveDurationMinutes.value,
    busy,
    notAfter: latestStart.value,
  })
}

// A day only ever renders as clickable once this agrees a free slot exists
// there -- optimistically bookable (true) until the month's busy/blocked
// data has actually loaded, so the grid doesn't flash everything grey while
// loadMonthAvailability is still in flight.
function dayHasAvailability(date: Date): boolean {
  if (!monthAvailabilityLoaded.value || !appointmentType.value) return true
  if (anyPractitionerMode.value) {
    return availablePractitioners.value.some((m) => {
      const busy = [...(monthBusyByMember.value[m.id] ?? []), ...blocksForMember(m.id)]
      return slotsForMember(date, m.business_hours, busy).length > 0
    })
  }
  const busy = [...(monthBusyByMember.value[teamMemberId.value] ?? []), ...blocksForMember(teamMemberId.value)]
  return slotsForMember(date, teamMember.value?.business_hours, busy).length > 0
}

const daySlots = computed<DaySlot[]>(() => {
  if (!selectedDate.value || !appointmentType.value) return []
  const date = selectedDate.value

  if (anyPractitionerMode.value) {
    // Union across every practitioner -- a slot is offered if at least one of
    // them is free then, and gets tagged with whichever one so pickSlot can
    // resolve teamMemberId to a real practitioner once the patient commits.
    const merged = new Map<number, string>()
    for (const m of availablePractitioners.value) {
      const busy = [...(monthBusyByMember.value[m.id] ?? []), ...blocksForMember(m.id)]
      const times = slotsForMember(date, m.business_hours, busy)
      for (const time of times) {
        if (!merged.has(time.getTime())) merged.set(time.getTime(), m.id)
      }
    }
    return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([ms, memberId]) => ({ time: new Date(ms), memberId }))
  }

  const busy = [...(monthBusyByMember.value[teamMemberId.value] ?? []), ...blocksForMember(teamMemberId.value)]
  const times = slotsForMember(date, teamMember.value?.business_hours, busy)
  return times.map((time) => ({ time, memberId: teamMemberId.value }))
})

const morningSlots = computed(() => daySlots.value.filter((s) => clinicHourOf(s.time, clinicTimeZone.value) < 14))
const afternoonSlots = computed(() => daySlots.value.filter((s) => clinicHourOf(s.time, clinicTimeZone.value) >= 14))

function pickSlot(slot: DaySlot) {
  selectedSlot.value = slot.time
  if (anyPractitionerMode.value) teamMemberId.value = slot.memberId
  phase.value = 'details'
}

// --- patient details ---
const firstName = ref('')
const lastName = ref('')
const email = ref('')
// Starts on the clinic's own country, not Spain's. A patient booking with
// a French clinic sees +33 selected, and only changes it if their number is
// from somewhere else. Set once the booking payload lands.
const dialCode = ref('ES')
// What the closed country picker shows: flag and prefix only. The open
// native list still names every country, but "🇪🇸 +34 Spain" in the closed
// field took the whole row on a phone and squeezed the number input to a
// sliver nobody could type into.
const selectedCountry = computed(() => COUNTRIES_BY_NAME.find((c) => c.code === dialCode.value))
const phoneNumber = ref('')
const note = ref('')
// The contact fields' labels, shared by the booking form and the class waitlist.
const FIELD = {
  firstName: { es: 'Nombre', en: 'First name', fr: 'Prénom' },
  lastName: { es: 'Apellidos', en: 'Last name', fr: 'Nom' },
  email: { es: 'Correo electrónico', en: 'Email', fr: 'E-mail' },
  phone: { es: 'Número de móvil', en: 'Mobile number', fr: 'Numéro de portable' },
} satisfies Record<string, Record<BookingLanguage, string>>
const submitting = ref(false)
const submitError = ref('')
const confirmation = ref<{ starts_at: string } | null>(null)
// Kept separately from `confirmation` because the success redirect needs it
// after the payment step too, where `goToSuccess` runs from a different call
// site and no longer has the booking result in hand.
const lastBooking = ref<{ appointmentId: string; typeName: string; valueEur: number } | null>(null)
const invoiceId = ref('')
const paymentRequiredCents = ref(0)

// Only after the patient has tried to submit, or left the field. Marking the
// number wrong while it is still being typed calls every number wrong for the
// first eight digits of it.
const phoneChecked = ref(false)
const phoneError = computed(() => {
  if (!phoneChecked.value || looksLikePhoneNumber(phoneNumber.value, dialCode.value)) return ''
  return dialCode.value === 'ES'
    ? say({ es: 'Un número español tiene 9 dígitos. Revíselo, por favor.', en: 'A Spanish number has 9 digits. Please check it.', fr: 'Un numéro espagnol comporte 9 chiffres. Veuillez le vérifier.' })
    : say({ es: 'Ese número no parece completo. Revíselo, por favor.', en: 'That number does not look complete. Please check it.', fr: 'Ce numéro ne semble pas complet. Veuillez le vérifier.' })
})

async function submitBooking() {
  if (!selectedSlot.value) return
  submitError.value = ''
  // Caught here as well as in create_public_booking. The RPC is the rule --
  // it is security definer and anon can call it without the form -- but
  // being told at the last step by a raised exception, in English, is not
  // how anyone should find out they mistyped their own number.
  phoneChecked.value = true
  if (!looksLikePhoneNumber(phoneNumber.value, dialCode.value)) return
  submitting.value = true
  // Through our own server rather than straight to the RPC, so the clinic's
  // alert has gone out before this returns -- see book.post.ts.
  let data: unknown
  try {
    data = await $fetch('/api/public-booking/book', {
      method: 'POST',
      body: {
        p_account_slug: slug,
        p_clinic_id: clinicId.value,
        p_team_member_id: teamMemberId.value,
        p_appointment_type_id: appointmentTypeId.value,
        p_starts_at: selectedSlot.value.toISOString(),
        p_first_name: firstName.value,
        p_last_name: lastName.value,
        p_email: email.value,
        // Bare number, no dial prefix -- country_code is stored separately and
        // every display site (patients/Banner.vue, ContactNumbersEditor.vue)
        // already prepends the dial code itself from country_code.
        p_phone: phoneNumber.value,
        p_country_code: dialCode.value,
        p_note: note.value,
        p_discount_code: discountCode.value.trim() || undefined,
        gift_code: giftChecked.value?.ok ? giftCode.value.trim() : undefined,
        // Kept on a new patient as their preferred_language (book.post.ts).
        language: lang.value,
      },
    })
  } catch (err: any) {
    submitting.value = false
    // create_public_booking's own refusal, in the page's language.
    submitError.value = bookingRefusal(err?.data?.data?.message)
    return
  }
  submitting.value = false
  const result = data as unknown as { appointment_id: string; starts_at: string; invoice_id: string | null; payment_required_cents: number; discount_applied_cents: number; card_url?: string | null; gift?: { redeemed: boolean; label?: string; message?: string; reason?: string } | null }
  cardUrl.value = result.card_url ?? null
  giftResult.value = result.gift ?? null
  confirmation.value = result
  discountAppliedCents.value = result.discount_applied_cents ?? 0
  // Conversion event for whatever's listening on the account's GTM container
  // (Settings > Online Booking > General) -- the appointment already exists
  // at this point regardless of payment, so this fires once per real booking
  // rather than only after a successful online payment.
  lastBooking.value = {
    appointmentId: result.appointment_id,
    typeName: appointmentType.value?.name ?? '',
    valueEur: effectivePrice.value ? effectivePrice.value / 100 : 0,
  }
  ;(window as any).dataLayer = (window as any).dataLayer || []
  ;(window as any).dataLayer.push({
    event: 'booking_completed',
    booking_appointment_type: appointmentType.value?.name ?? '',
    booking_value: effectivePrice.value ? effectivePrice.value / 100 : 0,
    booking_currency: 'EUR',
  })
  // Fire-and-forget, same as the staff-booking side (NewAppointmentPanel.vue) --
  // a failed confirmation send should never block the success screen the
  // patient is about to see.
  $fetch('/api/public-booking/send-confirmation', { method: 'POST', body: { accountSlug: slug, appointmentId: result.appointment_id } }).catch(() => {})
  // Same fire-and-forget reasoning: the booking is already made, and a
  // marketing record that fails to save must never surface to the patient.
  if (visitAttribution.value) {
    $fetch('/api/public-booking/attribution', {
      method: 'POST',
      body: {
        accountSlug: slug,
        appointmentId: result.appointment_id,
        params: visitAttribution.value.params,
        referrer: visitAttribution.value.referrer,
        landingPath: visitAttribution.value.landingPath,
      },
    }).catch(() => {})
  }
  // Booking always succeeds first regardless of payment -- if the type requires
  // online payment, the appointment already exists (visible to staff) before
  // the patient even sees the payment step, so a dropped connection here never
  // leaves a charged customer with no booking or a booking silently unpaid
  // and untracked.
  if (result.invoice_id && result.payment_required_cents > 0) {
    invoiceId.value = result.invoice_id
    paymentRequiredCents.value = result.payment_required_cents
    phase.value = 'payment'
  } else if (cardUrl.value) {
    phase.value = 'card'
  } else {
    goToSuccess()
  }
}

// The account can point completed bookings at a page of its own (Settings >
// Online Booking > "Successful booking page") instead of the built-in
// confirmation screen -- usually so a conversion tag fires on their own
// thank-you page. Only http(s) is honoured: this value goes straight into
// window.location, and a javascript: URL there would execute as script on
// the public booking page. Anything unparseable falls back to the built-in
// screen rather than stranding the patient on a blank page.
// The booking is described in the query string -- appointment id, type name,
// value -- so the account's thank-you page can report an exact conversion
// value and deduplicate on the id, neither of which a static URL can do.
// Nothing identifying the patient goes in there: the id is opaque and the
// rest describes the booking, not the person.
function successUrl(): URL | null {
  const configured = info.value?.account.online_booking_success_url?.trim()
  if (!configured) return null
  let target: URL
  try {
    target = new URL(configured)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  const booking = lastBooking.value
  if (booking) {
    target.searchParams.set('booking', booking.appointmentId)
    target.searchParams.set('type', booking.typeName)
    target.searchParams.set('value', booking.valueEur.toFixed(2))
    target.searchParams.set('currency', 'EUR')
  }
  return target
}

// How long the host page gets to take the redirect over before the frame
// navigates itself. Long enough for a message handler to run, short enough
// that a host which isn't listening shows no perceptible delay.
const HOST_REDIRECT_GRACE_MS = 150

function goToSuccess() {
  const target = successUrl()
  if (!target) {
    phase.value = 'success'
    return
  }
  // Embedded in someone else's page: offer the redirect to the host first. It
  // owns the top-level window, so it can navigate there directly. The frame
  // cannot rely on doing that itself -- a cross-origin frame may only navigate
  // its top window while it still holds user activation, and that can easily
  // have expired across the booking round-trip, in which case the browser
  // blocks it silently. A host that ignores the message still gets redirected
  // by the frame navigation below, just inside the iframe.
  if (window.self !== window.top) {
    window.parent.postMessage(
      { source: 'quiroflow-booking', event: 'booking_completed', url: target.href },
      '*',
    )
    window.setTimeout(() => {
      window.location.href = target.href
    }, HOST_REDIRECT_GRACE_MS)
    return
  }
  window.location.href = target.href
}

function onPaymentSucceeded() {
  if (cardUrl.value) phase.value = 'card'
  else goToSuccess()
}

function backToDatetime() {
  phase.value = 'datetime'
}

function backToSelect() {
  phase.value = 'select'
}

function proceedToDatetime() {
  phase.value = 'datetime'
  if (!isClass.value) loadMonthAvailability()
}

// --- iframe embed: report height to parent so a fixed-height iframe isn't needed ---
if (import.meta.client) {
  const reportHeight = () => {
    if (window.self === window.top) return
    window.parent.postMessage({ source: 'quiroflow-booking', height: document.documentElement.scrollHeight }, '*')
  }
  onMounted(() => {
    reportHeight()
    const observer = new ResizeObserver(reportHeight)
    observer.observe(document.documentElement)
  })
}

// --- the clinic's data, rendered on the server ---
//
// get_public_booking_info and get_public_booking_policy used to be called
// from onMounted, so the first HTML a patient received said "Cargando…" and
// the practitioners appeared only once the browser had downloaded the app
// and made two more round trips (p95 455 ms and 204 ms, measured 17 Oct
// 2026). Fetched here instead, the server renders the practitioners,
// services and clinic details into the HTML and the browser hydrates from
// the payload without calling either RPC again; the '/book/**' rule in
// nuxt.config.ts then lets Netlify's cache answer repeat visits without
// running the function at all.
//
// Only what holds for a minute is fetched here. Busy and blocked times
// (loadMonthAvailability) stay in the browser.
//
// Last in the script on purpose: applyBooking writes refs declared all the
// way down, and nothing after an await here may call a composable.
type BookingPolicy = NonNullable<typeof policy.value>
type BookingPayload =
  | { status: 'ok'; info: BookingInfo; policy: BookingPolicy | null }
  | { status: 'not_found' }
  // The RPC itself failed (database, network), as opposed to answering that
  // there is no such clinic. Kept apart so that a blip is not cached as
  // "booking unavailable" for the next minute, and so the browser tries once
  // more itself.
  | { status: 'failed' }

const cdnCacheControl = useResponseHeader('Netlify-CDN-Cache-Control')
// A signed-in staff member previewing their own page: the payload then
// carries their session (useSupabaseUser), which must not be served from the
// CDN to the next visitor of the same URL.
const previewedByStaff = import.meta.server && !!useSupabaseUser().value

const { data: booking, refresh: refreshBooking } = await useAsyncData<BookingPayload>(`public-booking:${slug}`, async () => {
  const [infoResult, policyResult] = await Promise.all([
    supabase.rpc('get_public_booking_info', { p_slug: slug }),
    supabase.rpc('get_public_booking_policy', { p_slug: slug }),
  ])
  // An unknown slug is an exception from the RPC ('Not found'), not a null:
  // that one is an answer like any other and may be cached. Anything else
  // from it is the call failing.
  if (infoResult.error) return infoResult.error.message === 'Not found' ? { status: 'not_found' } : { status: 'failed' }
  const parsed = infoResult.data as unknown as BookingInfo | null
  if (!parsed || parsed.clinics.length === 0) return { status: 'not_found' }
  return { status: 'ok', info: parsed, policy: (policyResult.data as BookingPolicy | null) ?? null }
})

if (import.meta.server) {
  const cacheable = booking.value?.status === 'ok' || booking.value?.status === 'not_found'
  if (previewedByStaff || !cacheable) cdnCacheControl.value = 'no-store'
}

function monthOf(dateKey: string) {
  const [year, month] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

// Runs during setup on the server and again, from the payload, during
// hydration -- so the HTML and the first client render agree on every phase
// and selection. Anything that needs `window` is in onMounted below.
function applyBooking(payload: BookingPayload | null) {
  if (!payload || payload.status !== 'ok') {
    phase.value = 'not_found'
    return
  }
  const parsed = payload.info
  info.value = parsed
  policy.value = payload.policy
  dialCode.value = parsed.account.default_phone_country || 'ES'
  clinicId.value = parsed.clinics[0].id
  // Marketing pages can deep-link straight into a specific offer (e.g. a
  // promo page's own appointment type/practitioner) via ?type=&practitioner=
  // -- falls back to the usual auto-select when absent or invalid.
  const queryTypeId = typeof route.query.type === 'string' ? route.query.type : null
  const queryPractitionerId = typeof route.query.practitioner === 'string' ? route.query.practitioner : null
  if (queryTypeId && parsed.appointment_types.some((t) => t.id === queryTypeId)) {
    appointmentTypeId.value = queryTypeId
    typeLockedByQuery.value = true
  } else if (parsed.appointment_types.length === 1) {
    appointmentTypeId.value = parsed.appointment_types[0].id
  }
  const forClinic = parsed.team_members.filter((m) => m.clinic_ids.includes(clinicId.value))
  if (queryPractitionerId && forClinic.some((m) => m.id === queryPractitionerId)) {
    teamMemberId.value = queryPractitionerId
  } else if (forClinic.length === 1 || bypassPractitioner.value) {
    teamMemberId.value = forClinic[0]?.id ?? ''
  }
  // The calendar opens on the clinic's current month. new Date() alone is the
  // month wherever the code runs -- UTC on the server, the visitor's zone in
  // the browser -- and the two disagree for the first and last hours of every
  // month, which would hydrate a different grid from the one in the HTML.
  // The clinic's own date reads the same from both sides.
  viewMonth.value = monthOf(clinicToday.value)
  phase.value = 'select'
  // No real choice to present (bypass, or a single available practitioner)
  // -- skip straight to date/time instead of a screen whose only content is
  // a "Continuar" button.
  if (!showPractitionerCards.value && canContinueFromSelect.value) proceedToDatetime()
}
applyBooking(booking.value)

onMounted(async () => {
  // This is a public storefront other sites embed -- it must never follow
  // the visitor's OS/browser dark-mode preference (or an internal staff
  // member's saved theme, if previewed from inside the app). Always light,
  // with brand colors layered on top via brandStyle above.
  document.documentElement.setAttribute('data-theme', 'light')

  captureAttribution()

  // The server's language was read from Accept-Language, or the page came
  // from a cached copy: the browser's own list is the last word.
  lang.value = queryLang ?? bookingLanguageFromList(navigator.languages?.length ? navigator.languages : [navigator.language])

  // The server's fetch failed, so the HTML says the page is unavailable --
  // which a fetch of the browser's own can still put right.
  if (booking.value?.status !== 'ok' && booking.value?.status !== 'not_found') {
    await refreshBooking()
    applyBooking(booking.value)
  }

  const gtmId = info.value?.account.online_booking_gtm_id
  if (gtmId) {
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`
    document.head.appendChild(script)
  }
})

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div class="min-h-screen bg-surface-page px-4 py-10" :style="brandStyle">
    <div class="mx-auto max-w-5xl">
      <div v-if="phase === 'loading'" class="py-24 text-center text-sm text-ink-faint">{{ say({ es: 'Cargando…', en: 'Loading…', fr: 'Chargement…' }) }}</div>

      <div v-else-if="phase === 'not_found'" class="rounded-card border border-line bg-surface p-10 text-center">
        <p class="text-ink-muted">{{ say({ es: 'La reserva online no está disponible para esta clínica.', en: 'Online booking is not available for this clinic.', fr: 'La réservation en ligne n’est pas disponible pour ce cabinet.' }) }}</p>
      </div>

      <template v-else-if="info">
        <!-- The patient's language. Any choice is kept in the address
             (chooseLanguage), and the booking records it on the patient. -->
        <div class="mb-4 flex justify-end">
          <div role="group" :aria-label="say({ es: 'Idioma', en: 'Language', fr: 'Langue' })" class="inline-flex rounded-ctl border border-line bg-surface p-0.5 text-xs" data-cy="booking-language">
            <button
              v-for="l in BOOKING_LANGUAGES"
              :key="l"
              type="button"
              :lang="l"
              class="rounded-[6px] px-2.5 py-1 font-medium touch:min-h-[44px]"
              :class="l === lang ? 'bg-brand text-brand-on' : 'text-ink-muted hover:text-ink-900'"
              :aria-pressed="l === lang"
              :disabled="!hydrated"
              :data-cy="`booking-language-${l}`"
              @click="chooseLanguage(l)"
            >
              {{ LANGUAGE_NAMES[l] }}
            </button>
          </div>
        </div>
        <img v-if="clinicLogoUrl" :src="clinicLogoUrl" alt="" class="mx-auto h-12 w-auto object-contain" />
        <h1 class="text-center text-2xl font-semibold text-ink-900" :class="clinicLogoUrl ? 'mt-3' : ''">{{ t('heading', { es: 'Reservar una cita', en: 'Book an appointment', fr: 'Prendre rendez-vous' }) }}</h1>
        <p class="mt-1 text-center text-sm text-ink-muted">{{ info.account.name }}</p>

        <!-- Step 1: service / practitioner selection -->
        <div v-if="phase === 'select'">
          <div class="mt-6 flex flex-col items-center gap-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-warning-text">{{ say({ es: `Paso ${stepNumber} de 3`, en: `Step ${stepNumber} of 3`, fr: `Étape ${stepNumber} sur 3` }) }}</p>
            <div class="flex gap-1.5">
              <span v-for="n in 3" :key="n" class="h-1.5 w-1.5 rounded-full" :class="n === stepNumber ? 'bg-brand' : 'bg-line'"></span>
            </div>
          </div>
          <h2 class="mt-2 text-center text-2xl font-semibold text-ink-900">{{ stepTitle }}</h2>

          <div class="mt-6 grid gap-6 sm:grid-cols-3">
            <div class="space-y-3 sm:col-span-2">
              <div v-if="info.clinics.length > 1 || (info.appointment_types.length > 1 && !typeLockedByQuery)" class="rounded-card border border-line bg-surface p-4 shadow-card">
                <div v-if="info.clinics.length > 1">
                  <label :for="`${fieldId}-clinicId`" class="block text-sm font-medium text-ink-700">{{ say({ es: 'Clínica', en: 'Clinic', fr: 'Cabinet' }) }}</label>
                  <select :id="`${fieldId}-clinicId`" v-model="clinicId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm" @change="onClinicChange">
                    <option v-for="c in info.clinics" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </div>
                <div v-if="info.appointment_types.length > 1 && !typeLockedByQuery" :class="info.clinics.length > 1 ? 'mt-4' : ''">
                  <label :for="`${fieldId}-appointmentTypeId`" class="block text-sm font-medium text-ink-700">{{ say({ es: 'Servicio', en: 'Service', fr: 'Prestation' }) }}</label>
                  <select :id="`${fieldId}-appointmentTypeId`" v-model="appointmentTypeId" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm">
                    <option v-for="t in info.appointment_types" :key="t.id" :value="t.id">
                      {{ t.name }} — {{ t.duration_minutes }} min
                    </option>
                  </select>
                </div>
              </div>

              <template v-if="showPractitionerCards">
                <button
                  type="button"
                  class="flex w-full items-center justify-between rounded-card border border-line bg-surface p-4 text-left shadow-card transition hover:border-brand"
                  :disabled="!hydrated"
                  @click="chooseTeamMember(ANY_PRACTITIONER)"
                >
                  <div>
                    <p class="font-semibold text-ink-900">{{ t('any_practitioner_label', { es: 'Cualquier profesional', en: 'Any practitioner', fr: 'N’importe quel praticien' }) }}</p>
                    <p class="mt-1 text-sm text-ink-muted">
                      {{
                        t('any_practitioner_description', {
                          es: 'Esta opción le permite reservar una cita con cualquier profesional disponible en la especialidad y horario seleccionados.',
                          en: 'Book with whichever practitioner is available for the service and time you choose.',
                          fr: 'Réservez avec le praticien disponible pour la prestation et l’horaire choisis.',
                        })
                      }}
                    </p>
                  </div>
                  <span class="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl bg-surface-subtle text-ink-faint"><UiChevron dir="right" /></span>
                </button>
                <button
                  v-for="m in availablePractitioners"
                  :key="m.id"
                  type="button"
                  class="flex w-full items-center justify-between rounded-card border border-line bg-surface p-4 text-left shadow-card transition hover:border-brand"
                  :disabled="!hydrated"
                  @click="chooseTeamMember(m.id)"
                >
                  <div class="flex items-center gap-3">
                    <div class="flex h-9 touch:h-11 w-9 touch:w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-tint text-sm font-semibold text-brand-text">
                      <img v-if="practitionerPhotoUrl(m)" :src="practitionerPhotoUrl(m)!" class="h-full w-full object-cover" alt="" />
                      <template v-else>{{ practitionerInitials(m.full_name) }}</template>
                    </div>
                    <div>
                      <p class="font-semibold text-ink-900">{{ m.full_name }}</p>
                      <p class="mt-0.5 text-sm text-ink-muted">{{ practitionerAvailabilityLabel(m) }}</p>
                    </div>
                  </div>
                  <span class="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl bg-surface-subtle text-ink-faint"><UiChevron dir="right" /></span>
                </button>
              </template>

              <div v-else class="rounded-card border border-line bg-surface p-6 shadow-card">
                <p v-if="availablePractitioners.length === 0" class="text-sm text-danger-text">
                  {{ say({ es: 'No hay profesionales disponibles para reserva online en esta clínica.', en: 'No practitioners are available for online booking at this clinic.', fr: 'Aucun praticien n’est disponible pour la réservation en ligne dans ce cabinet.' }) }}
                </p>
                <UiBtn type="button" variant="primary" class="w-full" :class="availablePractitioners.length === 0 ? 'mt-4' : ''" :disabled="!canContinueFromSelect" @click="proceedToDatetime">
                  {{ say({ es: 'Continuar', en: 'Continue', fr: 'Continuer' }) }}
                </UiBtn>
              </div>
            </div>

            <BookingSummary :clinic="clinic" :appointment-type="appointmentType" :price-cents="effectivePrice" :team-member="null" :slot="null" :format-price="formatPrice" :online-payment-required="appointmentType?.online_payment_required" :deposit-cents="appointmentType?.online_deposit_cents" />
          </div>
        </div>

        <!-- Step 2: date & time -->
        <div v-else-if="phase === 'datetime'">
          <div class="mt-6 flex items-center justify-between">
            <div>
              <div class="flex items-center gap-2">
                <p class="text-xs font-semibold uppercase tracking-wide text-warning-text">{{ say({ es: `Paso ${stepNumber} de 3`, en: `Step ${stepNumber} of 3`, fr: `Étape ${stepNumber} sur 3` }) }}</p>
                <div class="flex gap-1.5">
                  <span v-for="n in 3" :key="n" class="h-1.5 w-1.5 rounded-full" :class="n === stepNumber ? 'bg-brand' : 'bg-line'"></span>
                </div>
              </div>
              <h2 class="mt-1 text-xl font-semibold text-ink-900">{{ stepTitle }}</h2>
            </div>
            <UiBtn type="button" variant="secondary" @click="backToSelect">
              &larr; {{ say({ es: 'Atrás', en: 'Back', fr: 'Retour' }) }}
            </UiBtn>
          </div>

          <div v-if="isClass" class="mt-6 flex flex-col gap-2.5" data-cy="class-sessions">
            <p v-if="!classInfo?.sessions.length" class="rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">
              {{ say({ es: 'No hay clases programadas por ahora. Llame a la clínica para apuntarse.', en: 'No classes are scheduled for now. Call the clinic to sign up.', fr: 'Aucun cours n’est programmé pour le moment. Appelez le cabinet pour vous inscrire.' }) }}
            </p>
            <button
              v-for="session in classInfo?.sessions ?? []"
              :key="session.id"
              type="button"
              class="flex items-center gap-3 rounded-card border p-3.5 text-left shadow-card"
              :class="session.places_left > 0 ? 'border-line bg-surface hover:border-brand' : waitlistFor?.id === session.id ? 'border-brand bg-surface-subtle' : 'border-line bg-surface-subtle hover:border-warning-border'"
              data-cy="class-session-option"
              :data-places-left="session.places_left"
              :disabled="!hydrated"
              @click="pickClassSession(session)"
            >
              <span class="min-w-0 flex-1">
                <span class="block text-[15px] font-semibold" :class="session.places_left > 0 ? 'text-ink-900' : 'text-ink-faint'">{{ classSessionLabel(session) }}</span>
                <span class="block text-xs text-ink-muted">{{ session.practitioner_name }}<template v-if="session.room_name"> · {{ session.room_name }}</template></span>
              </span>
              <span
                class="inline-flex h-6 shrink-0 items-center rounded-pill px-2.5 text-xs font-semibold"
                :class="session.places_left > 0 ? 'bg-brand-tint text-brand-text' : 'bg-warning-bg text-warning-text'"
              >{{
                session.places_left > 0
                  ? session.places_left === 1
                    ? say({ es: 'Queda 1 plaza', en: '1 place left', fr: '1 place restante' })
                    : say({ es: `Quedan ${session.places_left}`, en: `${session.places_left} left`, fr: `${session.places_left} restantes` })
                  : say({ es: 'Completa · lista de espera', en: 'Full · waitlist', fr: 'Complet · liste d’attente' })
              }}</span>
            </button>
            <div v-if="waitlistFor" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="class-waitlist-join">
              <template v-if="waitlistPosition === null">
                <p class="text-base font-semibold text-ink-900">{{ say({ es: 'La clase está completa', en: 'The class is full', fr: 'Le cours est complet' }) }}</p>
                <p class="mt-1 text-sm text-ink-muted">{{ say({ es: 'Apúntese y, si se libera una plaza, le enviaremos un enlace para quedársela.', en: 'Join the waitlist and, if a place comes free, we will send you a link to take it.', fr: 'Inscrivez-vous et, si une place se libère, nous vous enverrons un lien pour la réserver.' }) }}</p>
                <div class="mt-3 grid gap-3 sm:grid-cols-2">
                  <label class="block text-sm font-medium text-ink-700">{{ say(FIELD.firstName) }} *<input v-model="firstName" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm" data-cy="waitlist-first-name" /></label>
                  <label class="block text-sm font-medium text-ink-700">{{ say(FIELD.lastName) }}<input v-model="lastName" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm" data-cy="waitlist-last-name" /></label>
                  <label class="block text-sm font-medium text-ink-700">{{ say(FIELD.email) }} *<input v-model="email" type="email" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm" data-cy="waitlist-email" /></label>
                  <label class="block text-sm font-medium text-ink-700">{{ say(FIELD.phone) }} *
                    <span class="mt-1 flex gap-2">
                      <select v-model="dialCode" class="shrink-0 rounded-ctl border border-line-control px-2 py-2 text-base sm:text-sm">
                        <option v-for="c in COUNTRIES_BY_NAME" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }}</option>
                      </select>
                      <input v-model="phoneNumber" type="tel" class="min-w-0 flex-1 rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm" data-cy="waitlist-phone" />
                    </span>
                  </label>
                </div>
                <p v-if="waitlistError" role="alert" class="mt-2 text-sm text-danger-text">{{ waitlistError }}</p>
                <UiBtn variant="primary" class="mt-3 w-full" :disabled="joiningWaitlist" data-cy="waitlist-join" @click="joinWaitlist">{{ say({ es: 'Apuntarme a la lista de espera', en: 'Join the waitlist', fr: 'M’inscrire sur la liste d’attente' }) }}</UiBtn>
              </template>
              <template v-else>
                <p class="text-sm text-ink-muted">{{ say({ es: 'Está en la lista de espera en el puesto', en: 'Your place on the waitlist', fr: 'Votre position sur la liste d’attente' }) }}</p>
                <p class="text-3xl font-bold text-ink-900" data-cy="waitlist-position">{{ waitlistPosition }}</p>
                <p class="mt-1 text-sm text-ink-muted">{{ say({ es: 'Si se libera una plaza le avisaremos con un enlace para quedársela.', en: 'If a place comes free we will send you a link to take it.', fr: 'Si une place se libère, nous vous enverrons un lien pour la réserver.' }) }}</p>
              </template>
            </div>
          </div>
          <div v-else class="mt-6 grid gap-6 sm:grid-cols-3">
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between">
                <button type="button" class="rounded p-1 text-ink-faint hover:bg-surface-subtle" :disabled="!hydrated" :aria-label="say({ es: 'Mes anterior', en: 'Previous month', fr: 'Mois précédent' })" @click="prevMonth"><UiChevron dir="left" /></button>
                <span class="text-sm font-semibold text-ink-900">{{ monthLabel }}</span>
                <button type="button" class="rounded p-1 text-ink-faint hover:bg-surface-subtle" :disabled="!hydrated" :aria-label="say({ es: 'Mes siguiente', en: 'Next month', fr: 'Mois suivant' })" @click="nextMonth"><UiChevron dir="right" /></button>
              </div>
              <div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink-faint">
                <span v-for="(l, i) in WEEKDAY_LABELS[lang]" :key="i">{{ l }}</span>
              </div>
              <div class="mt-1 grid grid-cols-7 gap-1">
                <button
                  v-for="(day, i) in calendarDays"
                  :key="i"
                  type="button"
                  :disabled="!day.bookable || !hydrated"
                  class="aspect-square rounded-full text-sm font-medium"
                  :class="[
                    !day.inMonth || !day.bookable ? 'text-ink-faint' : '',
                    day.bookable && !(selectedDate && isSameDay(day.date, selectedDate)) ? 'bg-brand text-brand-on hover:bg-brand-hover' : '',
                    selectedDate && isSameDay(day.date, selectedDate) ? 'border-2 border-brand text-ink-900' : '',
                  ]"
                  @click="selectDate(day)"
                >
                  {{ day.date.getDate() }}
                </button>
              </div>
            </div>

            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <p v-if="!selectedDate" class="text-sm text-ink-faint">{{ say({ es: 'Elija un día del calendario.', en: 'Choose a day on the calendar.', fr: 'Choisissez un jour dans le calendrier.' }) }}</p>
              <template v-else>
                <p class="text-sm font-semibold text-ink-900">
                  {{ selectedDate.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }}
                </p>
                <div v-if="monthAvailabilityLoading" class="mt-3 text-sm text-ink-faint">{{ say({ es: 'Cargando horarios…', en: 'Loading times…', fr: 'Chargement des horaires…' }) }}</div>
                <template v-else>
                  <div v-if="daySlots.length === 0" class="mt-3 text-sm text-ink-faint">{{ say({ es: 'No hay horas disponibles ese día.', en: 'No times available that day.', fr: 'Aucun horaire disponible ce jour-là.' }) }}</div>
                  <div v-if="morningSlots.length" class="mt-3">
                    <p class="text-xs font-medium uppercase text-ink-faint">{{ say({ es: 'Mañana', en: 'Morning', fr: 'Matin' }) }}</p>
                    <div class="mt-1.5 flex flex-wrap gap-2">
                      <button
                        v-for="s in morningSlots"
                        :key="s.time.toISOString() + s.memberId"
                        type="button"
                        class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-brand-on hover:bg-brand-hover"
                        @click="pickSlot(s)"
                      >
                        {{ clinicTimeLabel(s.time, clinicTimeZone) }}
                      </button>
                    </div>
                  </div>
                  <div v-if="afternoonSlots.length" class="mt-3">
                    <p class="text-xs font-medium uppercase text-ink-faint">{{ say({ es: 'Tarde', en: 'Afternoon', fr: 'Après-midi' }) }}</p>
                    <div class="mt-1.5 flex flex-wrap gap-2">
                      <button
                        v-for="s in afternoonSlots"
                        :key="s.time.toISOString() + s.memberId"
                        type="button"
                        class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-brand-on hover:bg-brand-hover"
                        @click="pickSlot(s)"
                      >
                        {{ clinicTimeLabel(s.time, clinicTimeZone) }}
                      </button>
                    </div>
                  </div>
                </template>
              </template>
            </div>

            <BookingSummary :clinic="clinic" :appointment-type="appointmentType" :price-cents="effectivePrice" :team-member="teamMember" :slot="selectedSlot" :format-price="formatPrice" :online-payment-required="appointmentType?.online_payment_required" :deposit-cents="appointmentType?.online_deposit_cents" />
          </div>
        </div>

        <!-- Step 3: patient details -->
        <div v-else-if="phase === 'details'">
          <div class="mt-6 flex items-center justify-between">
            <div>
              <div class="flex items-center gap-2">
                <p class="text-xs font-semibold uppercase tracking-wide text-warning-text">{{ say({ es: `Paso ${stepNumber} de 3`, en: `Step ${stepNumber} of 3`, fr: `Étape ${stepNumber} sur 3` }) }}</p>
                <div class="flex gap-1.5">
                  <span v-for="n in 3" :key="n" class="h-1.5 w-1.5 rounded-full" :class="n === stepNumber ? 'bg-brand' : 'bg-line'"></span>
                </div>
              </div>
              <h2 class="mt-1 text-xl font-semibold text-ink-900">{{ stepTitle }}</h2>
            </div>
            <UiBtn type="button" variant="secondary" @click="backToDatetime">
              &larr; {{ say({ es: 'Atrás', en: 'Back', fr: 'Retour' }) }}
            </UiBtn>
          </div>

          <div class="mt-6 grid gap-6 sm:grid-cols-3">
            <form class="rounded-card border border-line bg-surface p-6 shadow-card sm:col-span-2" @submit.prevent="submitBooking">
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label :for="`${fieldId}-firstName`" class="block text-sm font-medium text-ink-700">{{ say(FIELD.firstName) }} *</label>
                  <input :id="`${fieldId}-firstName`" v-model="firstName" type="text" required :placeholder="say({ es: 'Su nombre', en: 'Your first name', fr: 'Votre prénom' })" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </div>
                <div>
                  <label :for="`${fieldId}-lastName`" class="block text-sm font-medium text-ink-700">{{ say(FIELD.lastName) }}</label>
                  <input :id="`${fieldId}-lastName`" v-model="lastName" type="text" :placeholder="say({ es: 'Sus apellidos', en: 'Your last name', fr: 'Votre nom' })" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </div>
                <div>
                  <label :for="`${fieldId}-email`" class="block text-sm font-medium text-ink-700">{{ say(FIELD.email) }} *</label>
                  <input :id="`${fieldId}-email`" v-model="email" type="email" required :placeholder="say({ es: 'Su dirección de correo', en: 'Your email address', fr: 'Votre adresse e-mail' })" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-ink-700">{{ say(FIELD.phone) }} *</label>
                  <div class="mt-1 flex gap-2">
                    <div class="relative flex shrink-0 items-center gap-1 rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                      <span aria-hidden="true">{{ selectedCountry?.flag }} {{ selectedCountry?.dial }}</span>
                      <svg class="h-3 w-3 text-ink-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                      <select v-model="dialCode" :aria-label="say({ es: 'Prefijo del país', en: 'Country code', fr: 'Indicatif du pays' })" class="absolute inset-0 h-full w-full cursor-pointer text-base opacity-0">
                        <option v-for="c in COUNTRIES_BY_NAME" :key="c.code" :value="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
                      </select>
                    </div>
                    <input
                      v-model="phoneNumber"
                      type="tel"
                      inputmode="tel"
                      autocomplete="tel-national"
                      required
                      :placeholder="say({ es: 'Su número de móvil', en: 'Your mobile number', fr: 'Votre numéro de portable' })"
                      class="min-w-0 flex-1 rounded-ctl border px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-1"
                      :class="phoneError ? 'border-danger-border focus:border-danger-border focus:ring-danger-border' : 'border-line-control focus:border-brand focus:ring-brand'"
                      @blur="phoneChecked = true"
                    />
                  </div>
                  <p v-if="phoneError" class="mt-1 text-sm text-danger-text">{{ phoneError }}</p>
                </div>
              </div>
              <div class="mt-4">
                <label :for="`${fieldId}-note`" class="block text-sm font-medium text-ink-700">{{ say({ es: 'Notas', en: 'Notes', fr: 'Remarques' }) }}</label>
                <textarea :id="`${fieldId}-note`" v-model="note" rows="3" :placeholder="say({ es: '¿Algo que quiera que sepamos?', en: 'Anything you would like us to know?', fr: 'Quelque chose que vous souhaitez nous dire ?' })" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"></textarea>
              </div>
              <div v-if="giftOffered" class="mt-4" data-cy="booking-gift">
                <button v-if="!giftOpen" type="button" class="text-sm font-medium text-brand-text hover:underline" data-cy="booking-gift-open" @click="giftOpen = true">{{ say({ es: 'Tengo un bono regalo', en: 'I have a gift voucher', fr: 'J’ai un bon cadeau' }) }}</button>
                <template v-else>
                  <label for="gift-code" class="block text-sm font-medium text-ink-700">{{ say({ es: 'Código del bono regalo', en: 'Gift voucher code', fr: 'Code du bon cadeau' }) }}</label>
                  <div class="mt-1 flex max-w-[320px] gap-2">
                    <input id="gift-code" v-model="giftCode" type="text" placeholder="REGALO-…" class="w-full rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm uppercase focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" data-cy="booking-gift-code" @input="giftChecked = null" />
                    <UiBtn type="button" variant="secondary" :disabled="checkingGift || !giftCode.trim()" data-cy="booking-gift-check" @click="checkGift">{{ checkingGift ? say({ es: 'Comprobando…', en: 'Checking…', fr: 'Vérification…' }) : say({ es: 'Aplicar', en: 'Apply', fr: 'Appliquer' }) }}</UiBtn>
                  </div>
                  <p v-if="giftChecked?.ok" class="mt-1.5 text-sm text-success-text" data-cy="booking-gift-ok">✓ {{ giftDescription(giftChecked) }}</p>
                  <p v-else-if="giftChecked" class="mt-1.5 text-sm text-danger-text" data-cy="booking-gift-error">{{ giftRefusal(giftChecked) }}</p>
                </template>
              </div>
              <div v-if="info.account.discount_codes_enabled" class="mt-4">
                <label :for="`${fieldId}-discountCode`" class="block text-sm font-medium text-ink-700">{{ say({ es: 'Código de descuento', en: 'Discount code', fr: 'Code de réduction' }) }}</label>
                <input :id="`${fieldId}-discountCode`" v-model="discountCode" type="text" :placeholder="say({ es: 'Opcional', en: 'Optional', fr: 'Facultatif' })" class="mt-1 w-full max-w-[200px] rounded-ctl border border-line-control px-3 py-2 text-base sm:text-sm uppercase focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
              </div>
              <!-- The clinic's cancellation and no-show fees, before they book. -->
              <p v-if="policy && (policy.cancellation_fee_cents || policy.missed_appointment_fee_cents || policy.card_on_file)" class="mt-4 rounded-ctl bg-surface-subtle px-3 py-2.5 text-[13px] leading-snug text-ink-700" data-cy="booking-policy">
                <template v-if="policy.cancellation_fee_cents">{{ say({ es: `Cancelar con menos de ${policy.notice_hours} h de antelación: ${formatPrice(policy.cancellation_fee_cents)}.`, en: `Cancelling less than ${policy.notice_hours} h ahead: ${formatPrice(policy.cancellation_fee_cents)}.`, fr: `Annulation moins de ${policy.notice_hours} h à l’avance : ${formatPrice(policy.cancellation_fee_cents)}.` }) }} </template>
                <template v-if="policy.missed_appointment_fee_cents">{{ say({ es: `No presentarse a la cita: ${formatPrice(policy.missed_appointment_fee_cents)}.`, en: `Missing the appointment: ${formatPrice(policy.missed_appointment_fee_cents)}.`, fr: `Rendez-vous non honoré : ${formatPrice(policy.missed_appointment_fee_cents)}.` }) }} </template>
                <template v-if="policy.card_on_file">{{ say({ es: 'Tras reservar te pediremos una tarjeta para garantizar la cita; ahora no se cobra nada.', en: 'After booking we will ask for a card to hold the appointment; nothing is charged now.', fr: 'Après la réservation, nous vous demanderons une carte pour garantir le rendez-vous ; rien n’est débité maintenant.' }) }}</template>
              </p>
              <p v-if="submitError" class="mt-3 text-sm text-danger-text">{{ submitError }}</p>
              <UiBtn type="submit" variant="primary" class="mt-5" :disabled="submitting">
                {{ submitting ? say({ es: 'Reservando…', en: 'Booking…', fr: 'Réservation…' }) : t('confirm_button', { es: 'Reservar cita', en: 'Book appointment', fr: 'Réserver' }) }}
              </UiBtn>
            </form>

            <BookingSummary :clinic="clinic" :appointment-type="appointmentType" :price-cents="effectivePrice" :team-member="teamMember" :slot="selectedSlot" :format-price="formatPrice" :online-payment-required="appointmentType?.online_payment_required" :deposit-cents="appointmentType?.online_deposit_cents" />
          </div>
        </div>

        <!-- Step 3: payment (only when the appointment type requires it) -->
        <div v-else-if="phase === 'payment'" class="mx-auto mt-8 max-w-md">
          <h2 class="text-center text-xl font-semibold text-ink-900">{{ say({ es: 'Pago', en: 'Payment', fr: 'Paiement' }) }}</h2>
          <p class="mt-1 text-center text-sm text-ink-muted">{{ say({ es: 'Su cita ya está reservada. Complete el pago para confirmarla.', en: 'Your appointment is booked. Complete the payment to confirm it.', fr: 'Votre rendez-vous est réservé. Effectuez le paiement pour le confirmer.' }) }}</p>
          <BookingPayment class="mt-6" :account-slug="slug" :invoice-id="invoiceId" :amount-cents="paymentRequiredCents" :format-price="formatPrice" @paid="onPaymentSucceeded" />
        </div>

        <!-- Step 3b: a card to hold the booking, when the clinic asks for one -->
        <div v-else-if="phase === 'card'" class="mx-auto mt-10 max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-card" data-cy="booking-card-step">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-2xl text-success-text">✓</div>
          <h2 class="mt-4 text-lg font-semibold text-ink-900">{{ say({ es: 'Tu cita está reservada', en: 'Your appointment is booked', fr: 'Votre rendez-vous est réservé' }) }}</h2>
          <p v-if="policy && (policy.cancellation_fee_cents || policy.missed_appointment_fee_cents)" class="mt-2 text-sm text-ink-muted">
            {{ say({ es: `Para garantizarla, añade una tarjeta. No se cobra nada ahora; solo se usaría si cancelas con menos de ${policy.notice_hours} h o no vienes.`, en: `To hold it, add a card. Nothing is charged now; it would only be used if you cancel less than ${policy.notice_hours} h ahead or do not come.`, fr: `Pour le garantir, ajoutez une carte. Rien n’est débité maintenant ; elle ne servirait que si vous annulez moins de ${policy.notice_hours} h à l’avance ou ne venez pas.` }) }}
          </p>
          <p v-else class="mt-2 text-sm text-ink-muted">{{ say({ es: 'Para garantizarla, añade una tarjeta. No se cobra nada ahora.', en: 'To hold it, add a card. Nothing is charged now.', fr: 'Pour le garantir, ajoutez une carte. Rien n’est débité maintenant.' }) }}</p>
          <UiBtn variant="primary" class="mt-5 w-full" data-cy="booking-add-card" @click="openCardPage">{{ say({ es: 'Añadir tarjeta', en: 'Add a card', fr: 'Ajouter une carte' }) }}</UiBtn>
          <button type="button" class="mt-3 text-[13px] text-ink-muted hover:text-ink-700" data-cy="booking-skip-card" @click="goToSuccess">{{ say({ es: 'Ahora no', en: 'Not now', fr: 'Pas maintenant' }) }}</button>
        </div>

        <!-- Success -->
        <div v-else-if="phase === 'success'" class="mx-auto mt-10 max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-card">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-2xl text-success-text">✓</div>
          <h2 class="mt-4 text-lg font-semibold text-ink-900">{{ t('success_heading', { es: '¡Cita reservada!', en: 'Appointment booked!', fr: 'Rendez-vous réservé !' }) }}</h2>
          <p class="mt-2 text-sm text-ink-muted">
            {{ confirmation ? new Date(confirmation.starts_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short', hourCycle: 'h23', timeZone: clinicTimeZone }) : '' }}
          </p>
          <p class="mt-1 text-sm text-ink-muted">{{ teamMember?.full_name }} · {{ clinic?.name }}</p>
          <!-- How to reach this location if plans change -- its own phone
               and email from Settings -> Clinics, each only when set. -->
          <div v-if="clinic?.address || clinic?.phone || clinic?.email" class="mt-3 flex flex-col gap-0.5 text-sm text-ink-muted" data-cy="booking-clinic-contact">
            <span v-if="clinic?.address" class="whitespace-pre-line">{{ clinic?.address }}</span>
            <span v-if="clinic?.phone || clinic?.email">
              <a v-if="clinic?.phone" :href="`tel:${(clinic?.phone ?? '').replace(/\s+/g, '')}`" class="font-medium text-brand-text hover:underline">{{ clinic?.phone }}</a>
              <template v-if="clinic?.phone && clinic?.email"> · </template>
              <a v-if="clinic?.email" :href="`mailto:${clinic?.email ?? ''}`" class="font-medium text-brand-text hover:underline">{{ clinic?.email }}</a>
            </span>
          </div>
          <p v-if="discountAppliedCents > 0" class="mt-1 text-sm text-success-text">{{ say({ es: 'Descuento aplicado', en: 'Discount applied', fr: 'Réduction appliquée' }) }}: {{ formatPrice(discountAppliedCents) }}</p>
          <p v-if="giftResult?.redeemed" class="mt-1 text-sm text-success-text" data-cy="booking-gift-redeemed">{{ say({ es: `Bono regalo canjeado: ${giftResult.label}, ya en tu cuenta de la clínica.`, en: `Gift voucher redeemed: ${giftResult.label}, now on your account at the clinic.`, fr: `Bon cadeau utilisé : ${giftResult.label}, désormais sur votre compte au cabinet.` }) }}</p>
          <p v-else-if="giftResult" class="mt-1 text-sm text-danger-text" data-cy="booking-gift-not-redeemed">{{ giftRefusal(giftResult) }}</p>
          <p
            v-if="info.account.appointment_confirmation_enabled && info.account.appointment_confirmation_channels.includes('email')"
            class="mt-4 text-xs text-ink-faint"
          >
            {{ say({ es: `Le hemos enviado los detalles a ${email}.`, en: `We have sent the details to ${email}.`, fr: `Nous avons envoyé les détails à ${email}.` }) }}
          </p>
        </div>

        <!-- Straight after booking is the one moment a patient is certain to
             be holding their phone and already sold on the clinic, so this
             sits here rather than in a later email nobody opens. Its own
             v-if, not part of the phase chain above, so the confirmation card
             keeps its centred layout and this keeps a left-aligned one.
             In the patient's language, not the viewer's staff preference. -->
        <AppDownloadPrompt
          v-if="phase === 'success'"
          :lang="lang"
          class="mx-auto mt-4 max-w-md"
          :heading="t('app_promo_heading', { es: 'Descarga la app de QuiroFlow', en: 'Get the QuiroFlow app', fr: 'Téléchargez l’app QuiroFlow' })"
          :body="
            t('app_promo_body', {
              es: 'Consulta tus citas, documentos y mensajes desde el móvil, y recibe un recordatorio antes de cada visita.',
              en: 'See your appointments, documents and messages on your phone, and get a reminder before every visit.',
              fr: 'Consultez vos rendez-vous, documents et messages sur votre téléphone, et recevez un rappel avant chaque visite.',
            })
          "
        />
      </template>
    </div>
  </div>
</template>
