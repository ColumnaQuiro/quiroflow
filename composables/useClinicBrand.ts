// The clinic's own look in the patient app: its name, its logo and its
// colour, in place of QuiroFlow's (20261111063546_patient_app_branding.sql).
//
// One piece of state for the whole app. mobile/plugins/brand.client.ts puts
// back what this phone saw last time before the first paint -- so the app
// opens in the clinic's colours with no network -- and then asks again, so a
// clinic that changes its colour, or stops paying for the add-on, is followed
// on the next launch.
//
// Patients only. The same app is the staff's, and they keep QuiroFlow's look:
// layouts/practitioner.vue calls hide() while it is on screen. That takes the
// colours off without forgetting them, for the person who is both.
//
// No imports: this file is loaded by the mobile build too, where `~` is
// mobile/. clinicBrandCss (utils/clinicBrandPalette.ts) is auto-imported in both.

export interface ClinicBrand {
  name: string
  /** Lower-case #rrggbb, or null when the clinic set a logo or name only. */
  color: string | null
  logoUrl: string | null
}

const STORAGE_KEY = 'clinic_brand'
const STYLE_ID = 'clinic-brand-colours'

function isBrand(value: unknown): value is ClinicBrand {
  const v = value as Partial<ClinicBrand> | null
  return !!v && typeof v.name === 'string' && (v.color === null || typeof v.color === 'string') && (v.logoUrl === null || typeof v.logoUrl === 'string')
}

export function useClinicBrand() {
  const supabase = useSupabaseClient()
  const stored = useState<ClinicBrand | null>('clinic-brand', () => null)
  const hidden = useState<boolean>('clinic-brand-hidden', () => false)

  /** What to draw with right now: null on the staff side, and when the clinic has no look of its own. */
  const brand = computed(() => (hidden.value ? null : stored.value))

  // The colours are a stylesheet rather than inline styles on <html>, so the
  // dark theme's own block of them can sit beside the light one and
  // useTheme() switching [data-theme] needs to know nothing about this.
  function paint() {
    if (!import.meta.client) return
    const css = brand.value ? clinicBrandCss(brand.value.color) : ''
    let tag = document.getElementById(STYLE_ID)
    if (!css) {
      tag?.remove()
      return
    }
    if (!tag) {
      tag = document.createElement('style')
      tag.id = STYLE_ID
      document.head.appendChild(tag)
    }
    if (tag.textContent !== css) tag.textContent = css
  }

  function set(next: ClinicBrand | null) {
    stored.value = next
    if (import.meta.client) {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(STORAGE_KEY)
    }
    paint()
  }

  /** What this device drew with last time, before anything is fetched. */
  function restore() {
    if (!import.meta.client) return
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
      if (isBrand(saved)) stored.value = saved
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
    paint()
  }

  /**
   * Asks the clinic's current look: by its join code when the device has one
   * (which works signed out, so the sign-in screen is the clinic's already),
   * otherwise for the signed-in patient's clinic.
   *
   * A failed call changes nothing -- a phone with no signal keeps the look it
   * had. Only an answer of "none" takes it off.
   */
  async function load(slug?: string | null) {
    const { data, error } = await supabase.rpc('get_clinic_branding', slug ? { p_slug: slug } : {})
    if (error) return
    const raw = data as { name?: unknown; color?: unknown; logo_path?: unknown } | null
    if (!raw || typeof raw.name !== 'string') {
      set(null)
      return
    }
    set({
      name: raw.name,
      color: typeof raw.color === 'string' ? raw.color : null,
      logoUrl: typeof raw.logo_path === 'string' && raw.logo_path ? supabase.storage.from('clinic-logos').getPublicUrl(raw.logo_path).data.publicUrl : null,
    })
  }

  function clear() {
    set(null)
  }

  /** The staff side is on screen: QuiroFlow's look, the clinic's kept for later. */
  function hide() {
    hidden.value = true
    paint()
  }

  function show() {
    hidden.value = false
    paint()
  }

  return { brand, restore, load, clear, hide, show }
}
