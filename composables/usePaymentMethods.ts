// The methods staff can record a payment against, from Settings -> Payment
// Methods rather than from a list hardcoded in each dropdown.
//
// There were six of those lists, in four files, and they had already drifted:
// only the refund dialog offered "Other (e.g. bank transfer)", so a transfer
// could be refunded but never taken. Meanwhile the settings screen invited
// staff to add exactly that and wired it to nothing.
//
// Two methods are deliberately NOT here. 'credit' spends a patient's account
// balance and 'write_off' settles an invoice without money; both carry
// behaviour the caller has to opt into -- the take-payment form offers credit
// as its own option, gated on there being credit to spend. Treating them as
// ordinary choices is how you get a factura issued for money that never
// arrived. They exist as rows (is_system) only so the foreign key on
// payments.method holds for the payments the app writes itself.
//
// Cached at module scope and scoped by RLS rather than by an account_id
// filter, same as useBillingTemplates: this is small, account-wide reference
// data that six dropdowns on one screen should not fetch six times. Filtering
// on store.accountId was the first attempt and it silently returned nothing --
// the store has no account yet when a Billing tab mounts, so every picker
// rendered empty.
export interface PaymentMethodOption {
  key: string
  name: string
}

const methods = ref<PaymentMethodOption[] | null>(null)
let pending: Promise<void> | null = null

async function ensureLoaded() {
  if (methods.value) return
  if (!pending) {
    const supabase = useSupabaseClient()
    pending = Promise.resolve(
      supabase
        .from('payment_methods')
        .select('key, name')
        .eq('is_active', true)
        .eq('is_system', false)
        .order('sort_order')
        .order('name'),
    ).then(({ data }) => {
      methods.value = (data ?? []) as PaymentMethodOption[]
      pending = null
    })
  }
  await pending
}

// The five seeded methods keep their translations, keyed on the stable key --
// the stored name is DATA and cannot go through t(), so without this an
// English clinic and a Spanish one would both see whatever language the seed
// happened to be written in.
//
// Matched on the seeded English name, not on the key alone: the moment a
// clinic renames "Card" to "TPV Redsys", that is their word for it and must
// win over ours. Anything they added themselves has no entry here and shows
// exactly as typed.
const SEEDED_LABELS: Record<string, { name: string; es: string }> = {
  cash: { name: 'Cash', es: 'Efectivo' },
  card: { name: 'Card', es: 'Tarjeta' },
  transfer: { name: 'Bank transfer', es: 'Transferencia bancaria' },
  bizum: { name: 'Bizum', es: 'Bizum' },
  other: { name: 'Other', es: 'Otro' },
}

export function usePaymentMethods() {
  const t = useT()
  /**
   * The label for a row, translated when it is still a seeded built-in.
   *
   * Takes the row rather than reading the cache, so the settings screen can
   * use it too: that screen lists INACTIVE methods as well, which the cache
   * deliberately excludes, and it loads its own rows anyway. Rendering from
   * the cache there showed raw keys -- "transfer" instead of "Bank transfer"
   * -- for every row, since a freshly loaded page has no cache yet.
   */
  const display = (m: PaymentMethodOption) => {
    const seeded = SEEDED_LABELS[m.key]
    return seeded && seeded.name === m.name ? t(seeded.name, seeded.es) : m.name
  }

  return {
    methods: computed(() => (methods.value ?? []).map((m) => ({ key: m.key, name: display(m) }))),
    ensureLoaded,
    /**
     * What to preselect: the first method the clinic configured, so somewhere
     * working mostly in cash gets cash and somewhere on card gets card,
     * instead of everyone getting whatever happened to be first in the old
     * hardcoded list.
     *
     * 'cash' only covers the moment before the list arrives -- every account
     * is seeded, so an empty list means "not loaded yet", not "none".
     */
    defaultMethod: computed(() => methods.value?.[0]?.key ?? 'cash'),
    /** The label for a stored key, for anything rendering history. */
    labelFor: (key: string) => {
      const found = methods.value?.find((m) => m.key === key)
      return found ? display(found) : key
    },
    /** For a row the caller already holds -- see display(). */
    displayName: display,
    invalidate: () => {
      methods.value = null
    },
  }
}
