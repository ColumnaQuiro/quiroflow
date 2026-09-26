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
}

onMounted(load)
watch(() => store.teamMember?.id, load)

// Open first (oldest at the top: the longest-waiting call comes first), then done.
const ordered = computed(() => {
  const open = tasks.value.filter((x) => !x.done_at).sort((a, b) => (a.due_at ?? a.created_at).localeCompare(b.due_at ?? b.created_at))
  const done = tasks.value.filter((x) => x.done_at)
  return [...open, ...done]
})
const openCount = computed(() => tasks.value.filter((x) => !x.done_at).length)

async function toggle(task: TaskRow) {
  const next = task.done_at ? null : new Date().toISOString()
  const previous = task.done_at
  task.done_at = next
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
  <div v-if="loaded && tasks.length > 0" class="px-4 pt-4 sm:px-6 sm:pt-6">
  <div class="w-full overflow-hidden rounded-card border border-line bg-surface-sidebar shadow-card" data-cy="my-day-tasks">
    <div class="flex items-baseline gap-2 border-b border-line-row px-4 py-2.5">
      <h2 class="text-[13.5px] font-[620] text-ink-900">{{ t('Tasks', 'Tareas') }}</h2>
      <span class="text-[12px] text-ink-muted2">{{ openCount }} {{ openCount === 1 ? t('to do', 'pendiente') : t('to do', 'pendientes') }}</span>
    </div>
    <ul class="flex flex-col gap-0.5 p-2">
      <li v-for="task in ordered" :key="task.id" class="flex items-start gap-2.5 rounded-ctl px-2 py-2" data-cy="my-day-task">
        <button
          type="button"
          data-cy="my-day-task-toggle"
          class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          :class="task.done_at ? 'bg-success-accent text-white' : 'border border-line-control text-ink-faint3 hover:border-line-controlHover hover:text-ink-muted2'"
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
  </div>
  </div>
</template>
