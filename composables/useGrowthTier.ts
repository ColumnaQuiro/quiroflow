// Growth is a paid add-on, and this is where the screens ask whether this
// account has it.
//
// It used to be a flag in localStorage, because nothing in the database said
// -- get_my_bootstrap returned only { status, trial_ends_at } and there was
// no column to read. That has changed: subscriptions.growth_addon exists,
// the bootstrap returns it, and server/utils/requireGrowth.ts enforces it on
// every Growth route. So the answer now comes from the same place the API
// gets it, and the two cannot disagree.
//
// The ?growth= override survives for one reason: the e2e suite needs to
// render both states, and a preview of a locked screen is harmless because
// the API is no longer taking the client's word for anything. Flipping it on
// an account that has not bought Growth gets you the screens and 402s from
// every endpoint behind them -- which is exactly what it should do.
const PREVIEW_KEY = 'quiroflow-growth-preview'

export function useGrowthTier() {
  const route = useRoute()
  const account = useAccountStore()

  // Resolved on the client only. The entitlement is in the store, which is
  // populated by the bootstrap call after mount, and the preview flag lives
  // in localStorage which the server cannot read -- so deciding during SSR
  // would render the locked state and swap it on hydration. Pages render
  // their skeleton until `resolved` flips, the same way the rest of the app
  // waits on the account store.
  const hasGrowth = ref(false)
  const resolved = ref(false)

  function decide() {
    let preview: string | null = null
    try {
      const q = route.query.growth
      if (q === '1' || q === '0') localStorage.setItem(PREVIEW_KEY, q)
      preview = typeof q === 'string' && (q === '1' || q === '0') ? q : localStorage.getItem(PREVIEW_KEY)
    } catch {
      // Safari in private mode throws on both. The query param still decides
      // this navigation; it just will not be remembered.
      const q = route.query.growth
      preview = q === '1' || q === '0' ? q : null
    }

    hasGrowth.value = preview === null ? account.hasGrowthAddon : preview === '1'
    resolved.value = true
  }

  onMounted(() => {
    decide()
    // The store fills in after its own bootstrap request, so a page mounted
    // before that lands would otherwise sit on the upgrade screen while the
    // account it is describing does have Growth.
    watch(() => account.hasGrowthAddon, decide)
  })

  return { hasGrowth, resolved }
}
