// Pricing and the plan delta shown on the Growth upgrade screen.
//
// These are the design's figures, not anything read from Stripe. The Growth
// tier has no price object yet, so "Start 14-day trial" cannot open Checkout
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
    label: 'Annual · 2 months free',
    price: '€249',
    unit: '/ month per clinic',
    note: '€2,988 billed yearly · 3 locations included',
    featured: true,
  },
  {
    key: 'monthly',
    label: 'Monthly',
    price: '€299',
    unit: '/ month per clinic',
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

export const PLAN_COLUMNS = [
  { key: 'solo' as const, name: 'Solo', price: '€89 / month', current: false },
  { key: 'clinic' as const, name: 'Clinic', price: '€169 / month', current: true },
  { key: 'growth' as const, name: 'Clinic + Growth', price: '€249 / month annual', current: false },
]
