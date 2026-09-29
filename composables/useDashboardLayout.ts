import type { WidgetSize } from '~/utils/dashboardWidgets'
import { CORE_WIDGET_TYPES, widgetDef } from '~/utils/dashboardWidgets'

export interface WidgetInstance {
  id: string
  type: string
  size: WidgetSize
}

function defaultLayout(): WidgetInstance[] {
  return CORE_WIDGET_TYPES.map((type) => ({
    id: crypto.randomUUID(),
    type,
    size: widgetDef(type)?.defaultSize ?? 'sm',
  }))
}

// localStorage can be missing or refuse (private mode, storage full, blocked
// site data); the cache is only ever a head start, so any failure is silent.
const CACHE_PREFIX = 'quiroflow-dashboard-layout:'
function readCache(memberId: string): WidgetInstance[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_PREFIX + memberId) ?? 'null')
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed.every((w) => typeof w?.id === 'string' && typeof w?.type === 'string' && typeof w?.size === 'string') ? parsed : null
  } catch {
    return null
  }
}
function writeCache(memberId: string, layout: WidgetInstance[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + memberId, JSON.stringify(layout))
  } catch {
    // see readCache
  }
}

export function useDashboardLayout() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()

  const widgets = ref<WidgetInstance[]>([])
  const loaded = ref(false)

  async function load() {
    // The account store's own load() is still in flight on a fresh client
    // boot (its middleware await doesn't block this component's onMounted),
    // so this previously returned early and never set `loaded` -- leaving
    // the dashboard stuck on "Loading…" forever with nothing to retry it.
    // Wait for teamMember to actually arrive instead of giving up on it.
    if (!store.teamMember) {
      await new Promise<void>((resolve) => {
        watch(() => store.teamMember, (v) => { if (v) resolve() }, { once: true })
      })
    }
    const memberId = store.teamMember!.id
    // Whatever this person's dashboard looked like last time, drawn at once
    // rather than behind a skeleton for the round trip that confirms it. The
    // database stays the authority and replaces it below if they differ --
    // the layout is per person, not per browser, so another device may have
    // changed it since.
    const cached = readCache(memberId)
    if (cached) {
      widgets.value = cached
      loaded.value = true
    }
    const shown = JSON.stringify(widgets.value)
    const { data, error } = await supabase
      .from('team_members')
      .select('dashboard_layout')
      .eq('id', memberId)
      .maybeSingle()
    // Edited while the answer was on its way: what they just did wins over
    // what the database said a moment before.
    if (cached && JSON.stringify(widgets.value) !== shown) return
    const stored = data?.dashboard_layout as WidgetInstance[] | null | undefined
    if (stored && stored.length > 0) {
      // Same ids, so the widgets would survive the swap, but an identical
      // layout has no reason to touch them at all.
      if (JSON.stringify(stored) !== shown) widgets.value = stored
      writeCache(memberId, stored)
    } else if (error) {
      // A failed read is not an empty layout: saving the default here would
      // overwrite the real one with it.
      if (!cached) widgets.value = defaultLayout()
    } else {
      // A first visit, or a cached layout whose save never landed. Neither
      // is worth holding the widgets back for, so the save runs behind them.
      if (!cached) widgets.value = defaultLayout()
      save()
    }
    loaded.value = true
  }

  async function save() {
    if (!store.teamMember) return
    writeCache(store.teamMember.id, widgets.value)
    await supabase.from('team_members').update({ dashboard_layout: widgets.value }).eq('id', store.teamMember.id)
  }

  function add(type: string) {
    if (widgets.value.some((w) => w.type === type)) return
    const def = widgetDef(type)
    widgets.value.push({ id: crypto.randomUUID(), type, size: def?.defaultSize ?? 'md' })
  }

  function remove(id: string) {
    widgets.value = widgets.value.filter((w) => w.id !== id)
  }

  function setSize(id: string, size: WidgetSize) {
    const w = widgets.value.find((w) => w.id === id)
    if (w) w.size = size
  }

  function reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const next = [...widgets.value]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    widgets.value = next
  }

  return { widgets, loaded, load, save, add, remove, setSize, reorder }
}
