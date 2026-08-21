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

export function useDashboardLayout() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()

  const widgets = ref<WidgetInstance[]>([])
  const loaded = ref(false)

  async function load() {
    if (!store.teamMember) return
    const { data } = await supabase
      .from('team_members')
      .select('dashboard_layout')
      .eq('id', store.teamMember.id)
      .maybeSingle()
    const stored = data?.dashboard_layout as WidgetInstance[] | null | undefined
    if (stored && stored.length > 0) {
      widgets.value = stored
    } else {
      widgets.value = defaultLayout()
      await save()
    }
    loaded.value = true
  }

  async function save() {
    if (!store.teamMember) return
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
