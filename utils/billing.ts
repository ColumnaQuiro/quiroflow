import { uiLocaleTag, type UiLanguage } from './uiLanguage'
// Money and dates, for the whole app.
//
// Every screen that shows a euro amount comes through here. It did not use
// to: each call site built its own string, and the result was `€45.00` on the
// patient record and calendar -- symbol first, dot decimal, which is English
// convention -- next to `45,00 €` on the subscription page. The same patient's
// balance read differently depending on which screen you were standing on.
//
// Cents in, formatted string out. The only exceptions are input values and
// CSV cells, which stay machine-readable and say so where they are.
//
// The rule that matters most here is the separation between what a plan
// COSTS PER MONTH and what the NEXT CHARGE will be. They are different
// numbers on an annual plan -- the charge is twelve months at once -- and
// they were once produced by the same helper, so an annual customer was told
// their next payment was 44,00 € while Stripe took 528,00 €. There is
// deliberately no function here that can be asked for "the price" without
// saying which of the two it means.

/** Spain is the only market today; both formats are fixed to it deliberately. */
const LOCALE = 'es-ES'

export const MONTHS_PER_YEAR = 12

// Note for anyone writing a test against this: Intl puts a NON-BREAKING
// space before the euro sign, which is correct Spanish typography and stops
// "€" being orphaned on its own line in a narrow table cell. Cypress's
// cy.contains() normalises that to a plain space before matching, while
// .should('contain', …) compares the raw text and does not -- so the two
// assertion styles need different strings for the same amount.
export function formatEur(cents: number): string {
  return (cents / 100).toLocaleString(LOCALE, { style: 'currency', currency: 'EUR' })
}

/**
 * For the few call sites that already hold euros rather than cents -- a
 * per-visit average, an imported balance. Rounds to the cent, which is all a
 * display needs, and keeps them on the same formatter as everything else.
 */
export function formatEurFromAmount(euros: number): string {
  return formatEur(Math.round(euros * 100))
}

// Dates, unlike amounts, follow the language they are read in. The helpers
// below were fixed to Spanish too, and a staff member using QuiroFlow in
// English read "Patient since 16 de junio de 2025" beside "Sat 8 Aug". Each
// takes the reader's language; Spanish when none is given, which is what the
// server-side callers (documents, messages to patients) want. A component gets
// them bound to the staff member's language from useDates().
export type DateLanguage = UiLanguage
const dateLocale = (lang: DateLanguage) => uiLocaleTag(lang)

/** "21 de octubre de 2026" / "21 October 2026". */
export function formatLongDate(iso: string | Date, lang: DateLanguage = 'es'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString(dateLocale(lang), { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * "in 21 days" / "today" / "3 days ago", from whole days between the two
 * dates. Intl.RelativeTimeFormat rather than a hand-rolled table so the
 * Spanish reads correctly ("dentro de 21 días") when the UI is in Spanish.
 */
export function formatRelativeDays(iso: string | Date, language: DateLanguage, now = new Date()): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  if (days === 0) return language === 'es' ? 'hoy' : language === 'en' ? 'today' : new Intl.RelativeTimeFormat(uiLocaleTag(language), { numeric: 'auto' }).format(0, 'day')
  return new Intl.RelativeTimeFormat(uiLocaleTag(language), { numeric: 'auto' }).format(days, 'day')
}

/** "28 oct 2026" / "28 Oct 2026" -- a row date that may be from another year (a ledger, a list of facturas). */
export function formatShortDateYear(iso: string | Date, lang: DateLanguage = 'es'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "13 sept" / "13 Sept" -- the compact form a date block or a row uses. */
export function formatShortDate(iso: string | Date, lang: DateLanguage = 'es'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString(dateLocale(lang), { day: 'numeric', month: 'short' })
}

// One formatter, built once: toLocaleTimeString with options builds a new
// Intl.DateTimeFormat on every call, and the calendar formats every block's
// times whenever its appointments change.
const TIME_FORMAT = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })

/** "10:06". 24-hour, because Spain writes it that way. */
export function formatTime(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  // format() throws on an invalid date where toLocaleTimeString said
  // "Invalid Date" -- and a half-typed time in the booking form is one.
  if (Number.isNaN(date.getTime())) return 'Invalid Date'
  return TIME_FORMAT.format(date)
}

/** "mié 23 sept" / "Wed 23 Sept" -- a day as the calendar names it in a header or a panel. */
export function formatWeekdayDate(iso: string | Date, lang: DateLanguage = 'es'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString(dateLocale(lang), { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
}

/** "miércoles, 23 sept" / "Wednesday 23 Sept" -- the day view's title. */
export function formatLongWeekdayDate(iso: string | Date, lang: DateLanguage = 'es'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString(dateLocale(lang), { weekday: 'long', day: 'numeric', month: 'short' })
}

/** The day and the month, split, for a two-line date block. */
export function dateBlock(iso: string | Date, lang: DateLanguage = 'es'): { day: string; month: string } {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return {
    day: date.toLocaleDateString(dateLocale(lang), { day: 'numeric' }),
    month: date.toLocaleDateString(dateLocale(lang), { month: 'short' }).replace('.', ''),
  }
}

export type BillingInterval = 'monthly' | 'annual'

export interface PlanPricing {
  monthlyPriceCents: number
  annualPriceCents: number
  extraProfessionalPriceCents: number | null
  /** What one location beyond the plan's own costs; null on a plan that does not sell them. */
  extraClinicPriceCents?: number | null
}

export interface AddonPricing {
  monthlyPriceCents: number
  annualPriceCents: number
}

export interface SubscriptionShape {
  interval: BillingInterval
  extraProfessionals: number
  /** Locations bought on top of the plan's own (Clinic only). */
  extraClinics?: number
  /** Whether the add-on is actually bought AND billed as its own line. */
  growthBilled: boolean
  /** Clinic locations billed the VeriFactu fee (0 until the clinic is live). */
  verifactuLocations?: number
  /** The AI receptionist bought on its own, as its own line (never alongside Growth). */
  receptionistBilled?: boolean
  /** The clinic's own brand in the patient app, bought as its own line. */
  brandingBilled?: boolean
}

/**
 * What one month of this configuration costs, ex-IVA.
 *
 * On an annual subscription this is the discounted per-month figure -- the
 * number a plan card shows next to "/mo". It is NEVER what gets charged on an
 * annual plan; see nextChargeTotal.
 */
export function pricePerMonth(
  plan: PlanPricing,
  subscription: SubscriptionShape,
  addon: AddonPricing | null,
  verifactuFee: AddonPricing | null = null,
  receptionist: AddonPricing | null = null,
  branding: AddonPricing | null = null,
): number {
  const annual = subscription.interval === 'annual'
  const base = annual ? plan.annualPriceCents : plan.monthlyPriceCents
  const seats = subscription.extraProfessionals * (plan.extraProfessionalPriceCents ?? 0)
  const locations = (subscription.extraClinics ?? 0) * (plan.extraClinicPriceCents ?? 0)
  const growth = subscription.growthBilled && addon ? (annual ? addon.annualPriceCents : addon.monthlyPriceCents) : 0
  const verifactu = verifactuFee ? (subscription.verifactuLocations ?? 0) * (annual ? verifactuFee.annualPriceCents : verifactuFee.monthlyPriceCents) : 0
  const receptionistLine = subscription.receptionistBilled && receptionist ? (annual ? receptionist.annualPriceCents : receptionist.monthlyPriceCents) : 0
  const brandingLine = subscription.brandingBilled && branding ? (annual ? branding.annualPriceCents : branding.monthlyPriceCents) : 0
  return base + seats + locations + growth + verifactu + receptionistLine + brandingLine
}

/**
 * What the next invoice will be for, ex-IVA -- twelve times the per-month
 * figure on an annual plan, and equal to it on a monthly one.
 *
 * This is a LOCAL ESTIMATE. Prefer the amount Stripe reports on the upcoming
 * invoice whenever it is available (billing-info returns it): Stripe knows
 * about prorations, credits, coupons and the exact tax rate, and this
 * function knows about none of them. Use this only as the fallback for an
 * account whose Stripe customer cannot be read.
 */
export function nextChargeTotal(
  plan: PlanPricing,
  subscription: SubscriptionShape,
  addon: AddonPricing | null,
  verifactuFee: AddonPricing | null = null,
  receptionist: AddonPricing | null = null,
  branding: AddonPricing | null = null,
): number {
  const perMonth = pricePerMonth(plan, subscription, addon, verifactuFee, receptionist, branding)
  return subscription.interval === 'annual' ? perMonth * MONTHS_PER_YEAR : perMonth
}

/**
 * How much cheaper a month is on annual billing, as a whole percentage --
 * "save 10%". Rounded rather than floored so 39 -> 35 reads as the 10% it
 * nearly is, not 11% or 9%.
 */
export function annualSavingPercent(pricing: AddonPricing): number {
  if (pricing.monthlyPriceCents <= 0) return 0
  return Math.round(((pricing.monthlyPriceCents - pricing.annualPriceCents) / pricing.monthlyPriceCents) * 100)
}

/**
 * Stripe refuses a Checkout Session whose `subscription_data.trial_end` is
 * less than 48 hours away. Half a day of headroom on top, so a trial that is
 * just over the line when the owner opens /subscription is not under it by
 * the time they press the button.
 */
export const CHECKOUT_MIN_TRIAL_SECONDS = 60 * 60 * 60

/**
 * When the Stripe subscription started from Checkout should first charge, as
 * the Unix timestamp Checkout's `trial_end` takes -- or null to charge now.
 *
 * The trial the clinic is already on carries over. The subscription page
 * tells a trialing owner to "add a card before then and nothing is
 * interrupted" and that the first payment "lands on" the trial's end date;
 * without this, Checkout billed the moment the card went in, and a clinic
 * adding one on day 3 of 30 paid that day and forfeited the other 27.
 *
 * Null (charge now) when there is no trial left to keep: the row is locked or
 * cancelled, the date has passed, or it is inside Stripe's 48-hour floor --
 * the last day or two of a trial is the one case where adding a card still
 * starts billing immediately. Never for a comped account, which carries
 * status 'trialing' with no real trial behind it.
 */
export function checkoutTrialEnd(
  row: { status: string; trial_ends_at: string | null; comped: boolean } | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!row || row.comped || row.status !== 'trialing' || !row.trial_ends_at) return null
  const endsAt = Math.floor(new Date(row.trial_ends_at).getTime() / 1000)
  if (!Number.isFinite(endsAt)) return null
  const nowSeconds = Math.floor(now.getTime() / 1000)
  return endsAt - nowSeconds >= CHECKOUT_MIN_TRIAL_SECONDS ? endsAt : null
}

/**
 * Stripe subscription statuses whose items can still be changed in place.
 *
 * The others are ended or never started. `canceled` and `incomplete_expired`
 * are final: Stripe refuses any update to them, so an owner whose
 * subscription had ended got a 500 from every attempt to pay again, for as
 * long as the dead id sat on the row. `incomplete` is a first payment still
 * waiting on the customer (3-D Secure left unfinished, usually), whose items
 * Stripe will not change either. For all three, the way to pay is a new
 * Checkout Session -- which is what the customer would have to do anyway.
 */
const CHANGEABLE_STRIPE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused'])

export function canChangeInPlace(stripeStatus: string): boolean {
  return CHANGEABLE_STRIPE_STATUSES.has(stripeStatus)
}

/**
 * Whether a customer.subscription.* event describes a subscription the
 * account has already moved on from, and must be ignored.
 *
 * Once an account can subscribe again after cancelling, it has more than one
 * Stripe subscription over its life, and Stripe delivers their events in no
 * promised order. The row mirrors one of them -- the id it holds. An event
 * about a DIFFERENT subscription that is itself over (deleted, cancelled,
 * expired before its first payment, or not yet paid for) must not write:
 * otherwise a late `deleted` for last year's subscription lands after this
 * month's `created` and locks an account that is paying.
 *
 * An event for a different subscription that IS live is the account moving
 * on to it, and is applied. With no id on the row yet, everything applies --
 * that is how the first subscription gets recorded at all.
 */
export function isSupersededSubscriptionEvent(opts: {
  rowSubscriptionId: string | null | undefined
  eventSubscriptionId: string
  eventStatus: string
  deleted: boolean
}): boolean {
  if (!opts.rowSubscriptionId || opts.rowSubscriptionId === opts.eventSubscriptionId) return false
  return opts.deleted || !canChangeInPlace(opts.eventStatus)
}

/** The six states a subscription can be in, as the UI names them. */
export type SubscriptionState = 'trialing' | 'active' | 'past_due' | 'locked' | 'canceled' | 'comped'

/**
 * Status plus the comped flag collapsed into the one value every pill, banner
 * and guard reads. Comped wins over the row's own status: a complimentary
 * account carries status 'trialing' forever and must never be told its trial
 * is ending.
 */
export function subscriptionState(status: string, comped: boolean): SubscriptionState {
  if (comped) return 'comped'
  if (status === 'trialing' || status === 'active' || status === 'past_due' || status === 'locked' || status === 'canceled') {
    return status
  }
  // An unrecognised status is not silently treated as healthy.
  return 'locked'
}

// ------------------------------------------------------------ trial's end
//
// A trial with no card on file does not stop on the day it ends. It runs on
// for a grace week -- everything working, the app saying every day that it
// has ended -- and then trial-expiry-cron sets 'locked', which is READ-ONLY,
// not locked out: every screen still opens, exports still work, and changing
// anything asks for a card (20261120184541_trial_grace_then_read_only.sql).

/** Days a trial with no card keeps working after it ends. */
export const TRIAL_GRACE_DAYS = 7

const DAY_MS = 86_400_000

/** When an ended trial turns read-only: trial_ends_at plus the grace week. */
export function trialGraceEndsAt(trialEndsAt: string | Date): Date {
  const ends = typeof trialEndsAt === 'string' ? new Date(trialEndsAt) : trialEndsAt
  return new Date(ends.getTime() + TRIAL_GRACE_DAYS * DAY_MS)
}

/**
 * Where a subscription row stands against the end of its trial, for the rows
 * that still have one to end: 'trial' (days left), 'grace' (ended, still
 * working), or null for everything else -- a comped account, a card already
 * on file (Stripe decides what happens then), or a row that is not trialing.
 */
export function trialPhase(
  row: { status: string | null; trial_ends_at: string | null; comped: boolean; has_stripe_subscription: boolean } | null | undefined,
  now: Date = new Date(),
): 'trial' | 'grace' | null {
  if (!row || row.comped || row.has_stripe_subscription || row.status !== 'trialing' || !row.trial_ends_at) return null
  return new Date(row.trial_ends_at).getTime() > now.getTime() ? 'trial' : 'grace'
}

function addMonthsClamped(date: Date, months: number): Date {
  const out = new Date(date.getTime())
  const day = out.getUTCDate()
  out.setUTCDate(1)
  out.setUTCMonth(out.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
  out.setUTCDate(Math.min(day, lastDay))
  return out
}

/**
 * Paying for the grace week, not getting it free.
 *
 * A card added during the grace week must not start the paid period on the
 * day it was added: the clinic has been using the app since the trial ended,
 * and starting from today would hand it those days for nothing and move its
 * billing date every time someone waits. The period starts when the trial
 * ended instead.
 *
 * Checkout cannot start a subscription in the past (backdate_start_date is a
 * Subscriptions API parameter; in Checkout it is preview-only), so the same
 * result is built from two parts Checkout does take: the billing cycle is
 * anchored one period after the trial ended -- which Stripe prorates, charging
 * from now to that anchor -- and the days already used since the trial ended
 * go on the first invoice as a one-off line (graceCatchUpCents). Together
 * they are one full period from the end of the trial, and every renewal after
 * lands on that date.
 *
 * Null when there is nothing to make up: still inside the trial (Checkout
 * carries it over instead, checkoutTrialEnd), comped, a card already there,
 * past the grace week -- an account that turned read-only could not work in
 * the meantime, so it pays from the day it comes back -- or an anchor too
 * close for Stripe to accept.
 */
export function graceBackdate(
  row: { status: string; trial_ends_at: string | null; comped: boolean; stripe_subscription_id?: string | null } | null | undefined,
  interval: BillingInterval,
  now: Date = new Date(),
): { periodStart: number; anchor: number } | null {
  if (!row || row.comped || row.stripe_subscription_id || row.status !== 'trialing' || !row.trial_ends_at) return null
  const ended = new Date(row.trial_ends_at)
  if (!Number.isFinite(ended.getTime()) || ended.getTime() > now.getTime()) return null
  if (now.getTime() - ended.getTime() > (TRIAL_GRACE_DAYS + 1) * DAY_MS) return null
  const anchor = addMonthsClamped(ended, interval === 'annual' ? MONTHS_PER_YEAR : 1)
  // Stripe wants the anchor in the future; a day of headroom so a page left
  // open does not cross it.
  if (anchor.getTime() - now.getTime() < DAY_MS) return null
  return { periodStart: Math.floor(ended.getTime() / 1000), anchor: Math.floor(anchor.getTime() / 1000) }
}

/**
 * The one-off charge for the days used since the trial ended: the period's
 * price, in the proportion of the period that has already gone. Stripe's own
 * proration charges the rest, from now to the anchor, by the same
 * seconds-over-period rule.
 */
export function graceCatchUpCents(periodCents: number, backdate: { periodStart: number; anchor: number }, now: Date = new Date()): number {
  const span = backdate.anchor - backdate.periodStart
  if (span <= 0 || periodCents <= 0) return 0
  const used = Math.max(0, Math.floor(now.getTime() / 1000) - backdate.periodStart)
  return Math.round((periodCents * used) / span)
}

/** Whole days until a date, rounded up, never below zero: "3 days left" on the morning of the third. */
export function daysUntil(when: string | Date, now: Date = new Date()): number {
  const at = typeof when === 'string' ? new Date(when) : when
  return Math.max(0, Math.ceil((at.getTime() - now.getTime()) / DAY_MS))
}

/**
 * Why a write was refused for unpaid billing: the database's `detail`
 * (refuse_writes_while_read_only) and the server's `data.reason`
 * (requireActiveAccount), so the app can tell it from every other refusal.
 */
export const ACCOUNT_READ_ONLY = 'account_read_only'

/** What a call site that prints the error shows. Spanish, as the database says it. */
export const READ_ONLY_MESSAGE_ES = 'Tu cuenta está en modo solo lectura. Añade un método de pago en Suscripción para seguir trabajando.'

/** Whether an account only reads: 'locked' (an ended trial, past its grace week) or 'canceled'. Never comped. */
export function isReadOnlyAccount(status: string | null | undefined, comped: boolean): boolean {
  return !comped && (status === 'locked' || status === 'canceled')
}

// Non-GET routes a read-only account may still call: ones that only read or
// export -- having its data is exactly what read-only promises -- and the
// ones for talking to us and to colleagues.
const READ_ONLY_ALLOWED_PATHS = [
  /^\/api\/patients\/[^/]+\/gdpr-export(\?|$)/,
  /^\/api\/patient-invoices\/pdf-link(\?|$)/,
  /^\/api\/automations\/segment-preview(\?|$)/,
  /^\/api\/support\//,
  /^\/api\/team-messages\//,
]

/** Whether requireActiveAccount lets a read-only account through to this request. */
export function readOnlyAllowsRequest(method: string, path: string): boolean {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true
  return READ_ONLY_ALLOWED_PATHS.some((re) => re.test(path))
}

/**
 * Whether the plan's practitioner and location caps are lifted: a comped
 * account, or a free trial nobody has put a card on yet. The same rule as
 * practitioner_seat_allowance() and clinic_location_allowance() in the
 * database (20260924100032), so the page never prints a limit the database
 * does not enforce, or the reverse.
 *
 * Also an account on grandfathered terms while it is on the plan they were
 * granted for (subscriptions.limits_waived_on_plan, 20261125062215).
 */
export function planLimitsWaived(
  row: { status: string; comped: boolean; stripe_subscription_id: string | null; plan_id?: string | null; limits_waived_on_plan?: string | null } | null | undefined,
): boolean {
  if (!row) return false
  return row.comped || limitsGrandfathered(row) || (row.status === 'trialing' && !row.stripe_subscription_id)
}

/** On the plan its grandfathered terms were granted for, so that plan's practitioner and location limits do not apply. */
export function limitsGrandfathered(row: { plan_id?: string | null; limits_waived_on_plan?: string | null } | null | undefined): boolean {
  return !!row?.limits_waived_on_plan && row.limits_waived_on_plan === row.plan_id
}

/**
 * Seat ceiling for a plan, or null for "no limit".
 *
 * Comped accounts and open trials genuinely have no ceiling --
 * practitioner_seat_allowance() returns null for them -- so printing "3 of 1
 * seats in use" claimed a limit that does not exist. `waived` is
 * planLimitsWaived().
 */
export function seatAllowance(
  includedProfessionals: number | null | undefined,
  extraProfessionals: number,
  waived: boolean,
): number | null {
  if (waived) return null
  if (includedProfessionals === null || includedProfessionals === undefined) return null
  return includedProfessionals + extraProfessionals
}

/**
 * Location ceiling for a plan, or null for "no limit": the plan's own plus
 * any bought on top. The same rule as clinic_location_allowance() in the
 * database -- bought locations count only on a plan that sells them, so a
 * row that has just left Clinic is not credited with the ones it had there.
 */
export function clinicAllowance(
  plan: { included_clinics: number | null; extra_clinic_price_cents: number | null } | null | undefined,
  extraClinics: number,
  waived: boolean,
): number | null {
  if (waived || !plan) return null
  if (plan.included_clinics === null) return null
  return plan.included_clinics + (plan.extra_clinic_price_cents === null ? 0 : extraClinics)
}

const GB = 1024 ** 3

export function bytesToGb(bytes: number): number {
  return bytes / GB
}

/** "19,8 GB" -- two decimals below 10 GB, one above, so small numbers stay legible. */
export function formatGb(gb: number): string {
  return `${gb.toLocaleString(LOCALE, { minimumFractionDigits: gb < 10 ? 2 : 1, maximumFractionDigits: gb < 10 ? 2 : 1 })} GB`
}

/** 0-100, clamped. Storage is headroom, so going over does not change the tone. */
export function meterPercent(used: number, allowance: number | null): number | null {
  if (!allowance) return null
  return Math.min(100, Math.max(0, Math.round((used / allowance) * 100)))
}
