// Pricing and the plan delta shown on the Growth upgrade screen.
//
// These are the design's figures, not anything read from Stripe. The Growth
// Growth is an add-on now, not a fourth tier, and priced like one: EUR 49 a
// month against plans costing EUR 69 to EUR 199, rather than the EUR 299
// that sat here when it was going to be its own plan. "per clinic" and
// "3 locations included" went with it -- an add-on sits on whatever plan the
// account already has, and locations come from there.
//
// The add-on has no Stripe price object yet, so "Start 14-day trial" cannot open Checkout
// -- pages/growth/index.vue routes it at /subscription instead, which is the
// one place in the app that already knows how to start and repair a
// subscription. Replace PLAN_COMPARISON's prices and GROWTH_PRICING with the
// live Stripe prices when the tier is created, so the page cannot drift from
// what the customer is actually charged.

export interface GrowthPricingOption {
  key: 'annual' | 'monthly'
  label: string
  price: string
  unit: string
  note: string
  featured: boolean
}

export interface PlanComparisonRow {
  feature: string
  note: string
  solo: string
  clinic: string
  growth: string
}

export const GROWTH_INCLUDED: string[] = [
  'AI receptionist on 3 channels',
  'Lead pipeline with attribution',
  'Unified inbox for every channel',
  'Visual automation builder',
  'Missed-call text back',
  'Reputation and AI review replies',
  'Cost per new patient by channel',
  'Spend and ROAS attribution',
]

export const GROWTH_PRICING: GrowthPricingOption[] = [
  {
    key: 'annual',
    label: 'Annual · save 20%',
    price: '€39',
    unit: '/ month',
    note: '€468 billed yearly',
    featured: true,
  },
  {
    key: 'monthly',
    label: 'Monthly',
    price: '€49',
    unit: '/ month',
    note: 'Cancel any time',
    featured: false,
  },
]

export const PLAN_COMPARISON: PlanComparisonRow[] = [
  { feature: 'Scheduling with room auto-assign', note: 'Already included', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'Patient records and clinical notes', note: 'Already included', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'Billing, packages and memberships', note: 'Already included', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'Campaigns', note: 'Already included in every plan', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'WhatsApp recalls', note: 'Already included in every plan', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'Public booking page', note: 'Already included', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'AI receptionist', note: 'Answers, qualifies and books', solo: '—', clinic: '—', growth: 'New' },
  { feature: 'Lead pipeline and attribution', note: 'Source to care plan', solo: '—', clinic: '—', growth: 'New' },
  { feature: 'Unified inbox', note: 'WhatsApp, SMS, email, web, Instagram', solo: '—', clinic: '—', growth: 'New' },
  { feature: 'Automation builder', note: 'Triggers, conditions, delays', solo: '—', clinic: 'Recalls only', growth: 'New' },
  { feature: 'Reputation and AI review replies', note: 'Google, Doctoralia, Facebook', solo: '—', clinic: '—', growth: 'New' },
  { feature: 'Cost per new patient and ROAS', note: 'Spend imported from ad accounts', solo: '—', clinic: '—', growth: 'New' },
  { feature: 'Locations included', note: '', solo: '1', clinic: '3', growth: '3' },
]

// Prices taken from the plans table rather than invented: Solo is EUR 59 and
// Clinic EUR 199, and the EUR 89 that stood here was a number no customer
// has ever been charged. The third column is no longer a bundle -- Growth is
// an add-on, so it is the same plan plus EUR 49 rather than a different one.
//
// `current` is false on all three because nothing here knows which plan the
// account is on; marking one as theirs was a guess the fixture could afford
// and a real screen cannot.
export const PLAN_COLUMNS = [
  { key: 'solo' as const, name: 'Solo', price: '€59 / month', current: false },
  { key: 'clinic' as const, name: 'Clinic', price: '€199 / month', current: false },
  { key: 'growth' as const, name: 'Your plan + Growth', price: '+€49 / month', current: false },
]
