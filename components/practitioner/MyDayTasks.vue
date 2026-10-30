<script setup lang="ts">
// "Tareas" in Mi día: what an automation's "Avisar" step asked this person --
// or their whole role -- to do ("Llamar a Ana"). The push that came with it is
// easy to miss; this is where it waits until somebody ticks it off.
//
// Always the signed-in person's own list (RLS: tasks assigned to them, or to
// their role), whichever practitioner's day the page is showing. Hidden when
// there is nothing on it, so a clinic without such automations sees no change.
interface TaskRow {
  id: string
  title: string
  due_at: string | null
  done_at: string | null
  created_at: string
  patient_id: string | null
  lead_id: string | null
  role_id: string | null
  patients: { first_name: string; last_name: string | null } | null
  leads: { full_name: string } | null
  automation_rules: { name: string } | null
  account_roles: { name: string } | null
}

const props = defineProps<{ privacyMode?: boolean }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const tasks = ref<TaskRow[]>([])
const loaded = ref(false)

// Whether this person had any tasks last time. The card is hidden when there
// are none, so it cannot hold its place with a skeleton unconditionally -- a
// placeholder that then vanishes is its own jump. But when there were tasks
// last time there almost certainly are now, and without a placeholder the
// card arrived late and pushed what follows it down the screen.
const hadTasksKey = computed(() => `myday-had-tasks:${store.teamMember?.id ?? ''}`)
const expectTasks = ref(false)
function readHadTasks() {
  try {
    expectTasks.value = localStorage.getItem(hadTasksKey.value) === '1'
  } catch {
    expectTasks.value = false
  }
}
function rememberHadTasks(had: boolean) {
  try {
    localStorage.setItem(hadTasksKey.value, had ? '1' : '0')
  } catch {
    // Private mode or blocked storage: the card just arrives without a placeholder.
  }
}

async function load() {
  if (!store.teamMember?.id) return
  // Open tasks, and the ones finished today -- so ticking one off does not
  // make it vanish before the person has seen it go grey.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const { data } = await supabase
    .from('staff_tasks')
    .select('id, title, due_at, done_at, created_at, patient_id, lead_id, role_id, patients(first_name, last_name), leads(full_name), automation_rules(name), account_roles(name)')
    .or(`done_at.is.null,done_at.gte.${startOfToday.toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(100)
  tasks.value = (data as unknown as TaskRow[]) ?? []
  loaded.value = true
  rememberHadTasks(tasks.value.length > 0)
}

onMounted(() => {
  readHadTasks()
  load()
})
watch(() => store.teamMember?.id, () => {
  readHadTasks()
  load()
})

// Open first (oldest at the top: the longest-waiting call comes first), then done.
// A task ticked here keeps its place, greyed, rather than sorting to the end --
// with the list cut to three, the end is out of sight.
const tickedHere = ref(new Set<string>())
const ordered = computed(() => {
  const isOpen = (x: TaskRow) => !x.done_at || tickedHere.value.has(x.id)
  const open = tasks.value.filter(isOpen).sort((a, b) => (a.due_at ?? a.created_at).localeCompare(b.due_at ?? b.created_at))
  const done = tasks.value.filter((x) => !isOpen(x))
  return [...open, ...done]
})
const openCount = computed(() => tasks.value.filter((x) => !x.done_at).length)

// Three, then "Show all". Tasks sat above the day's visits and an automation
// can raise twenty at once -- the same "Llamar para reprogramar" for each
// patient -- so a practitioner opening My Day met a wall of them before their
// first patient. What is hidden is still counted, by title, so a pile of one
// kind of task reads as one thing to deal with.
const COLLAPSED = 3
const expanded = ref(false)
const visible = computed(() => (expanded.value ? ordered.value : ordered.value.slice(0, COLLAPSED)))
const hiddenSummary = computed(() => {
  const counts = new Map<string, number>()
  for (const task of ordered.value.slice(COLLAPSED)) if (!task.done_at) counts.set(task.title, (counts.get(task.title) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([title, n]) => (n > 1 ? `${n} × «${title}»` : `«${title}»`))
    .join(', ')
})

async function toggle(task: TaskRow) {
  const next = task.done_at ? null : new Date().toISOString()
  const previous = task.done_at
  task.done_at = next
  tickedHere.value.add(task.id)
  const { error } = await supabase.from('staff_tasks').update({ done_at: next }).eq('id', task.id)
  if (error) task.done_at = previous
}

function who(task: TaskRow) {
  if (task.patients) return `${task.patients.first_name} ${task.patients.last_name ?? ''}`.trim()
  if (task.leads) return task.leads.full_name
  return ''
}
function link(task: TaskRow) {
  if (task.patient_id) return `/patients/${task.patient_id}`
  if (task.lead_id) return `/growth/leads?lead=${task.lead_id}`
  return null
}
function formatDue(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
</script>

<template>
  <div v-if="!loaded && expectTasks" aria-busy="true">
    <div class="w-full overflow-hidden rounded-card border border-line bg-surface-sidebar shadow-card">
      <div class="flex items-baseline gap-2 border-b border-line-row px-4 py-2.5">
        <h2 class="text-[13.5px] font-[620] text-ink-900">{{ t('Tasks', 'Tareas') }}</h2>
      </div>
      <div class="space-y-3 p-4">
        <div v-for="i in 2" :key="i" class="flex items-center gap-2.5">
          <UiSkeleton class="h-5 w-5 shrink-0 rounded-full" />
          <UiSkeleton class="h-3.5 w-1/2 rounded-ctlSm" />
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="loaded && tasks.length > 0">
  <div class="w-full overflow-hidden rounded-card border border-line bg-surface-sidebar shadow-card" data-cy="my-day-tasks">
    <div class="flex items-baseline gap-2 border-b border-line-row px-4 py-2.5">
      <h2 class="text-[13.5px] font-[620] text-ink-900">{{ t('Tasks', 'Tareas') }}</h2>
      <span class="text-[12px] text-ink-muted2">{{ openCount }} {{ openCount === 1 ? t('to do', 'pendiente') : t('to do', 'pendientes') }}</span>
    </div>
    <ul class="flex flex-col gap-0.5 p-2">
      <li v-for="task in visible" :key="task.id" class="flex items-start gap-2.5 rounded-ctl px-2 py-2" data-cy="my-day-task">
        <button
          type="button"
          data-cy="my-day-task-toggle"
          class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative touch:after:absolute touch:after:-inset-3 touch:after:content-['']"
          :class="task.done_at ? 'bg-success-accent text-success-on' : 'border border-line-control text-ink-faint3 hover:border-line-controlHover hover:text-ink-muted2'"
          :title="task.done_at ? t('Mark as not done', 'Marcar como pendiente') : t('Mark as done', 'Marcar como hecha')"
          :aria-label="task.done_at ? t('Mark as not done', 'Marcar como pendiente') : t('Mark as done', 'Marcar como hecha')"
          @click="toggle(task)"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 6.2l2.4 2.4 4.6-5.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <div class="min-w-0 flex-1">
          <p class="text-[13.5px] font-[560]" :class="task.done_at ? 'text-ink-faint line-through' : 'text-ink-900'" data-cy="my-day-task-title">{{ task.title }}</p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-ink-muted2">
            <NuxtLink
              v-if="link(task) && who(task)"
              :to="link(task)!"
              class="font-medium text-brand-text hover:underline"
              :class="{ 'blur-sm select-none': props.privacyMode }"
              data-cy="my-day-task-patient"
            >{{ who(task) }}</NuxtLink>
            <span v-if="task.automation_rules">· {{ t('Automation', 'Automatización') }} «{{ task.automation_rules.name }}»</span>
            <span v-if="task.account_roles">· {{ task.account_roles.name }}</span>
            <span v-if="task.due_at && !task.done_at">· {{ t('Due', 'Para') }} {{ formatDue(task.due_at) }}</span>
          </p>
        </div>
      </li>
    </ul>
    <div v-if="ordered.length > COLLAPSED" class="flex flex-wrap items-baseline gap-x-2 border-t border-line-row px-4 py-2">
      <button type="button" class="text-[12.5px] font-semibold text-brand-text hover:underline" data-cy="my-day-tasks-more" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? t('Show fewer', 'Ver menos') : t(`Show all ${ordered.length}`, `Ver las ${ordered.length}`) }}
      </button>
      <span v-if="!expanded && hiddenSummary" class="min-w-0 truncate text-[12px] text-ink-muted2">{{ t('Also', 'Además') }} {{ hiddenSummary }}</span>
    </div>
  </div>
  </div>
</template>
