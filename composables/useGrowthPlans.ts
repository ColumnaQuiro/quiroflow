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
// Who sees it: an account WITHOUT Growth, which since 28 Oct 2026 means Solo
// -- Practice and Clinic include Growth (utils/growthPlans.ts), and a trial
// already has it. So the comparison is "your plan", "your plan + Growth" and
// "Practice, the cheapest plan where it is included".

import { formatEur } from '~/utils/billing'
import { PLANS_INCLUDING_GROWTH } from '~/utils/growthPlans'

type T = (en: string, es: string) => string
type Pair = [en: string, es: string]

/** What a plan's cell says on a row: it has it, Growth brings it, or not. */
export type PlanCell = 'included' | 'new' | 'none'

export interface PlanComparisonRow {
  feature: Pair
  note: Pair | null
  solo: PlanCell
  clinic: PlanCell
  growth: PlanCell
}

// What Growth adds, in both languages. Checked against the code on 7 Nov
// 2026, because this list had drifted into things that do not exist: "3
// channels" when the receptionist answers on four (WhatsApp, Instagram,
// Messenger, web chat; config.get.ts) and SMS on none; "missed-call text
// back", a column nothing reads or sends; reviews from Doctoralia and Facebook,
// when only a Google listing can be connected; and ad spend "imported from ad
// accounts", when only Meta's is read in (sync-ad-spend.post.ts) and the rest
// is typed into the channel table.
export const GROWTH_INCLUDED: Pair[] = [
  ['AI receptionist on WhatsApp, Instagram, Messenger and web chat', 'Recepcionista IA en WhatsApp, Instagram, Messenger y el chat web'],
  ['Lead pipeline with attribution', 'Embudo de leads con atribución'],
  ['Leads in the same Inbox as your patients', 'Los leads en la misma Bandeja que tus pacientes'],
  ['Lead automations and follow-up sequences', 'Automatizaciones y secuencias de seguimiento para leads'],
  ['Google reviews with AI-drafted replies', 'Reseñas de Google con respuestas redactadas por IA'],
  ['Cost per new patient by channel', 'Coste por paciente nuevo por canal'],
  ['Ad spend and return (ROAS) by channel', 'Gasto en anuncios y retorno (ROAS) por canal'],
]

export function growthIncluded(t: T): string[] {
  return GROWTH_INCLUDED.map(([en, es]) => t(en, es))
}

// The bundled-plan column (Practice since 28 Oct 2026) reads "Included" on the
// Growth rows because that plan's price includes Growth; it read "—" until the reprice bundled it, which is the
// other half of what this screen got wrong.
//
// "Automation builder" was a Growth row, marked "—" for Solo, but every plan
// has Automations; what needs Growth is the lead triggers and steps
// (pages/automations/index.vue, "Lead automations need Growth").
export const PLAN_COMPARISON: PlanComparisonRow[] = [
  { feature: ['Scheduling with room auto-assign', 'Agenda con asignación automática de salas'], note: ['Already included', 'Ya incluido'], solo: 'included', clinic: 'included', growth: 'included' },
  { feature: ['Patient records and clinical notes', 'Fichas de paciente y notas clínicas'], note: ['Already included', 'Ya incluido'], solo: 'included', clinic: 'included', growth: 'included' },
  { feature: ['Billing, bonos and memberships', 'Facturación, bonos y membresías'], note: ['Already included', 'Ya incluido'], solo: 'included', clinic: 'included', growth: 'included' },
  { feature: ['Campaigns', 'Campañas'], note: ['Already included in every plan', 'Ya incluido en todos los planes'], solo: 'included', clinic: 'included', growth: 'included' },
  { feature: ['WhatsApp recalls', 'Recordatorios por WhatsApp'], note: ['Already included in every plan', 'Ya incluido en todos los planes'], solo: 'included', clinic: 'included', growth: 'included' },
  { feature: ['Online booking page', 'Página de reservas online'], note: ['Already included', 'Ya incluido'], solo: 'included', clinic: 'included', growth: 'included' },
  { feature: ['AI receptionist', 'Recepcionista IA'], note: ['Answers, qualifies and books', 'Responde, cualifica y reserva'], solo: 'none', clinic: 'included', growth: 'new' },
  { feature: ['Lead pipeline and attribution', 'Embudo de leads y atribución'], note: ['From first message to patient', 'Del primer mensaje a paciente'], solo: 'none', clinic: 'included', growth: 'new' },
  { feature: ['Leads in the Inbox', 'Leads en la Bandeja'], note: ['WhatsApp, Instagram, Messenger, web chat', 'WhatsApp, Instagram, Messenger, chat web'], solo: 'none', clinic: 'included', growth: 'new' },
  { feature: ['Lead automations', 'Automatizaciones de leads'], note: ['Follow-ups for every new lead', 'Seguimiento de cada lead nuevo'], solo: 'none', clinic: 'included', growth: 'new' },
  { feature: ['Reputation and AI review replies', 'Reputación y respuestas a reseñas con IA'], note: ['Google Business Profile', 'Perfil de Google Business'], solo: 'none', clinic: 'included', growth: 'new' },
  { feature: ['Cost per new patient and ROAS', 'Coste por paciente nuevo y ROAS'], note: ['Meta spend read in, other channels typed in', 'Gasto de Meta importado; el resto, a mano'], solo: 'none', clinic: 'included', growth: 'new' },
]

/** "1", or "Unlimited" for the null the catalogue uses to mean no cap. */
export function locationsLabel(includedClinics: number | null | undefined, t: T): string {
  return includedClinics === null || includedClinics === undefined ? t('Unlimited', 'Ilimitados') : String(includedClinics)
}

/** "49,00 € / month", or a dash while the catalogue is still loading. */
export function monthlyLabel(cents: number | null | undefined, t: T, prefix = ''): string {
  return cents === null || cents === undefined ? '—' : t(`${prefix}${formatEur(cents)} / month`, `${prefix}${formatEur(cents)} / mes`)
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
  // The cheapest plan Growth comes bundled with, found through the same set
  // the entitlement check uses rather than by a second hard-coded id. The
  // step a Solo clinic would actually take, so Practice rather than Clinic.
  const bundled = computed(
    () =>
      plans.value
        .filter((p) => PLANS_INCLUDING_GROWTH.has(p.id))
        .sort((a, b) => a.monthly_price_cents - b.monthly_price_cents)[0] ?? null,
  )

  return { growth, solo, bundled }
}
