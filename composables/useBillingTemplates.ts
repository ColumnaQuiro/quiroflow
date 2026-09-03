import type { Tables } from '~/types/database.types'

type PackageTemplate = Pick<Tables<'packages'>, 'id' | 'name' | 'session_count' | 'price_cents'>
type MembershipTemplate = Pick<Tables<'memberships'>, 'id' | 'name' | 'price_cents'>

// Account-wide reference data (the package/membership templates staff sell
// against) that changes only when someone edits it in Settings. Cached at
// module scope and shared across every patient's Billing tab -- without
// this, switching between patients refetched these same two small,
// unchanging tables on every single visit, adding two round trips to a
// tab that's already a network waterfall of invoices/purchases/schedules.
// Settings > Packages/Memberships call invalidate() after any insert or
// delete so the next Billing tab load never serves stale rows.
const packages = ref<PackageTemplate[] | null>(null)
const memberships = ref<MembershipTemplate[] | null>(null)
let pending: Promise<void> | null = null

async function ensureLoaded() {
  if (packages.value && memberships.value) return
  if (!pending) {
    const supabase = useSupabaseClient()
    pending = Promise.all([
      supabase.from('packages').select('id, name, session_count, price_cents').order('name'),
      supabase.from('memberships').select('id, name, price_cents').order('name'),
    ]).then(([pkg, mem]) => {
      packages.value = pkg.data ?? []
      memberships.value = mem.data ?? []
      pending = null
    })
  }
  await pending
}

export function useBillingTemplates() {
  return {
    packageTemplates: computed(() => packages.value ?? []),
    membershipTemplates: computed(() => memberships.value ?? []),
    ensureLoaded,
    invalidate: () => {
      packages.value = null
      memberships.value = null
      pending = null
    },
  }
}
