// Pricing and the plan delta shown on the Growth upgrade screen.
//
// Every price here is read from `plans` and `addons` -- the same rows
// /subscription quotes from and whose Stripe price ids subscribe.post.ts
// bills against -- rather than written into this file. It used to hold its
// own copy: Growth at 49 a month and 39 on annual ("save 20%"), Solo at 59
// and Clinic at 199. The reprice of 17 Sep 2026
// (20260917141806_reprice_plans_and_growth.sql) moved every one of those, and
// this screen went on quoting the old numbers to exactly the clinics being
// asked to buy, because nothing tied it to the catalogue. A price that lives
// in two places drifts; this one now lives in one.
//
// Who sees it: an account WITHOUT Growth, which after the reprice means Solo
// or Practice -- Clinic includes Growth (utils/growthPlans.ts), and a trial
// already has it. So the comparison is "your plan", "your plan + Growth" and
// "Clinic, where it is included".

import { formatEur } from '~/utils/billing'
import { PLANS_INCLUDING_GROWTH } from '~/utils/growthPlans'

export interface PlanComparisonRow {
  feature: string
  note: string
  solo: string
  clinic: string
  growth: string
}

export interface CataloguePrice {
  id: string
  name: string
  monthly_price_cents: number
  annual_price_cents: number
  included_clinics: number | null
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

// The Clinic column reads "Included" on the Growth rows because Clinic's price
// includes Growth; it read "—" until the reprice bundled it, which is the
// other half of what this screen got wrong.
export const PLAN_COMPARISON: PlanComparisonRow[] = [
  { feature: 'Scheduling with room auto-assign', note: 'Already included', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'Patient records and clinical notes', note: 'Already included', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'Billing, packages and memberships', note: 'Already included', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'Campaigns', note: 'Already included in every plan', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'WhatsApp recalls', note: 'Already included in every plan', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'Public booking page', note: 'Already included', solo: 'Included', clinic: 'Included', growth: 'Included' },
  { feature: 'AI receptionist', note: 'Answers, qualifies and books', solo: '—', clinic: 'Included', growth: 'New' },
  { feature: 'Lead pipeline and attribution', note: 'Source to care plan', solo: '—', clinic: 'Included', growth: 'New' },
  { feature: 'Unified inbox', note: 'WhatsApp, SMS, email, web, Instagram', solo: '—', clinic: 'Included', growth: 'New' },
  { feature: 'Automation builder', note: 'Triggers, conditions, delays', solo: '—', clinic: 'Included', growth: 'New' },
  { feature: 'Reputation and AI review replies', note: 'Google, Doctoralia, Facebook', solo: '—', clinic: 'Included', growth: 'New' },
  { feature: 'Cost per new patient and ROAS', note: 'Spend imported from ad accounts', solo: '—', clinic: 'Included', growth: 'New' },
]

/** "1", or "Unlimited" for the null the catalogue uses to mean no cap. */
export function locationsLabel(includedClinics: number | null | undefined): string {
  return includedClinics === null || includedClinics === undefined ? 'Unlimited' : String(includedClinics)
}

/** "49,00 € / month", or a dash while the catalogue is still loading. */
export function monthlyLabel(cents: number | null | undefined, prefix = ''): string {
  return cents === null || cents === undefined ? '—' : `${prefix}${formatEur(cents)} / month`
}

/**
 * The live catalogue: the three plans and the Growth add-on, straight from
 * the tables billing reads. Keyed so the upgrade card and the comparison
 * table below it share one request rather than making two.
 *
 * Client-only, like the rest of the Growth screens -- they render their
 * skeleton until the account store resolves, which is also after mount.
 */
export function useGrowthCatalogue() {
  const supabase = useSupabaseClient()
  const { data } = useLazyAsyncData(
    'growth-catalogue',
    async () => {
      const [{ data: plans }, { data: addons }] = await Promise.all([
        supabase.from('plans').select('id, name, monthly_price_cents, annual_price_cents, included_clinics'),
        supabase.from('addons').select('id, name, monthly_price_cents, annual_price_cents').eq('id', 'growth'),
      ])
      return {
        plans: (plans ?? []) as CataloguePrice[],
        growth: (addons?.[0] ?? null) as Omit<CataloguePrice, 'included_clinics'> | null,
      }
    },
    { server: false },
  )

  const plans = computed(() => data.value?.plans ?? [])
  const growth = computed(() => data.value?.growth ?? null)
  const solo = computed(() => plans.value.find((p) => p.id === 'starter') ?? null)
  // The plan Growth comes bundled with, found through the same set the
  // entitlement check uses rather than by a second hard-coded id.
  const bundled = computed(() => plans.value.find((p) => PLANS_INCLUDING_GROWTH.has(p.id)) ?? null)

  return { growth, solo, bundled }
}
