// Growth is a paid tier above the plan an account is already on: the
// acquisition layer (leads, AI receptionist, automations, reputation) sitting
// on top of the scheduling/records/billing the clinic already pays for.
//
// Nothing in the database says whether an account bought it yet.
// get_my_bootstrap returns only { status, trial_ends_at } for the
// subscription -- there is no plan_tier column -- so until that ships this
// composable is the one place the rest of the app asks the question. Every
// Growth screen gates on `hasGrowth` from here and nowhere else, so pointing
// it at the real column later is a one-file change instead of a hunt through
// every screen.
//
// Meanwhile the preview flag below is how the tier gets exercised: ?growth=1
// unlocks and ?growth=0 re-locks (both remembered, so it survives navigation
// between Growth pages), which is also how the e2e specs drive the two
// states. It is deliberately not a secret -- there is nothing behind the gate
// yet but fixture data, and an owner who flips it sees the same screens they
// would be buying.
const PREVIEW_KEY = 'quiroflow-growth-preview'

export function useGrowthTier() {
  const route = useRoute()

  // Resolved on the client only. The flag lives in localStorage, which the
  // server cannot read, so deciding during SSR would render the locked state
  // and then swap it out on hydration -- a mismatch warning plus a visible
  // flash of the wrong screen. Pages render their skeleton until `resolved`
  // flips, the same way the rest of the app waits on the account store.
  const hasGrowth = ref(false)
  const resolved = ref(false)

  onMounted(() => {
    const q = route.query.growth
    if (q === '1' || q === '0') {
      try {
        localStorage.setItem(PREVIEW_KEY, q)
      } catch {
        // Safari in private mode throws on setItem. The query param still
        // decides this navigation; it just will not be remembered.
      }
    }
    let stored: string | null = null
    try {
      stored = localStorage.getItem(PREVIEW_KEY)
    } catch {
      stored = null
    }
    hasGrowth.value = (q === '1' || q === '0' ? q : stored) === '1'
    resolved.value = true
  })

  return { hasGrowth, resolved }
}
