<script setup lang="ts">
import { isLeadTrigger, triggerTitle } from '~/utils/automationCatalog'
import { emptyLookup, filtersText, triggerDetail, type NameLookup } from '~/utils/automationDescribe'
import type { Problem } from '~/utils/automationTree'
import { serverMessage } from '~/utils/serverMessage'
import { normalizeSearchTerm } from '~/utils/searchText'

// Automations: every message and task that goes out on its own -- after an
// appointment, on a birthday, to a group of patients, to a new lead. Replaces
// Campaigns and Growth > Automations: this list is what Campaigns was, and
// each row opens the builder.

useHead({ title: 'Automations' })

const t = useT()
const route = useRoute()
const router = useRouter()
const supabase = useSupabaseClient()
const { showToast } = useToast()

interface Row {
  id: string
  name: string
  trigger_event: string
  enabled: boolean
  filters: Record<string, any>
  is_marketing: boolean
  dry_run: boolean
  segment: any
  created_at: string
  stepCount: number
  stepTypes: string[]
  hasConditions: boolean
  usesRuns: boolean
}
interface Stats {
  inside: number
  failedRuns: number
  entered: number
  converted: number
  whatsapp: { sent: number; delivered: number; read: number; failed: number; recorded: number }
  email: { sent: number; delivered: number; opened: number; clicked: number; bounced: number; failed: number; recorded: number }
}

const rules = ref<Row[]>([])
const stats = ref<Record<string, Stats>>({})
const canReadWhatsApp = ref(true)
const hasGrowth = ref(true)
const delayChanged = ref<{ id: string; name: string }[]>([])
const loading = ref(true)
const loadError = ref('')
const lookup = ref<NameLookup>(emptyLookup())

async function load() {
  try {
    const res = await useStaffFetch<{ rules: Row[]; stats: Record<string, Stats>; canReadWhatsApp: boolean; hasGrowth: boolean; delayChanged: { id: string; name: string }[] }>('/api/automations')
    rules.value = res.rules
    stats.value = res.stats
    canReadWhatsApp.value = res.canReadWhatsApp
    hasGrowth.value = res.hasGrowth
    delayChanged.value = res.delayChanged
  } catch (e) {
    loadError.value = serverMessage(e) ?? t('Could not load the automations.', 'No se han podido cargar las automatizaciones.')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  // An old Executions link (/growth/automations?run=…) lands on the run's own
  // automation, on its People tab.
  if (typeof route.query.run === 'string') {
    try {
      const res = await useStaffFetch<{ run: { ruleId: string } }>(`/api/automations/runs/${route.query.run}`)
      return router.replace(`/automations/${res.run.ruleId}?tab=people&run=${route.query.run}`)
    } catch {
      // Not found: fall through to the list.
    }
  }
  if (route.query.tab === 'executions' || route.query.filter === 'failed') filter.value = 'failed'
  load()
  const [types, members] = await Promise.all([
    supabase.from('appointment_types').select('id, name'),
    supabase.from('team_members').select('id, full_name, is_practitioner').is('deleted_at', null),
  ])
  lookup.value = {
    ...lookup.value,
    appointmentTypes: (types.data ?? []) as { id: string; name: string }[],
    practitioners: ((members.data ?? []) as { id: string; full_name: string; is_practitioner: boolean }[]).filter((m) => m.is_practitioner),
    members: (members.data ?? []) as { id: string; full_name: string }[],
    clinics: useAccountStore().clinics.map((c) => ({ id: c.id, name: c.name })),
  }
})

// ---- filters
type Filter = 'all' | 'active' | 'paused' | 'patients' | 'leads' | 'failed'
const filter = ref<Filter>('all')
const search = ref('')
const lockedLead = (r: Row) => isLeadTrigger(r.trigger_event) && !hasGrowth.value
const isActive = (r: Row) => r.enabled && !lockedLead(r)
const counts = computed(() => ({
  active: rules.value.filter(isActive).length,
  paused: rules.value.filter((r) => !isActive(r)).length,
  failed: rules.value.filter((r) => (stats.value[r.id]?.failedRuns ?? 0) > 0).length,
}))
const FILTERS = computed<{ key: Filter; label: string }[]>(() => [
  { key: 'all', label: t('All', 'Todas') },
  { key: 'active', label: `${t('Active', 'Activas')} · ${counts.value.active}` },
  { key: 'paused', label: `${t('Paused', 'Pausadas')} · ${counts.value.paused}` },
  { key: 'patients', label: t('Patients', 'Pacientes') },
  { key: 'leads', label: t('Leads', 'Leads') },
  { key: 'failed', label: `${t('With failures', 'Con fallos')} · ${counts.value.failed}` },
])
const visible = computed(() => {
  const q = normalizeSearchTerm(search.value.trim())
  return rules.value.filter((r) => {
    if (filter.value === 'active' && !isActive(r)) return false
    if (filter.value === 'paused' && isActive(r)) return false
    if (filter.value === 'patients' && isLeadTrigger(r.trigger_event)) return false
    if (filter.value === 'leads' && !isLeadTrigger(r.trigger_event)) return false
    if (filter.value === 'failed' && !(stats.value[r.id]?.failedRuns ?? 0)) return false
    if (q && !normalizeSearchTerm(`${r.name} ${triggerTitle(t, r.trigger_event, r.filters)}`).includes(q)) return false
    return true
  })
})

// ---- what each row says
const TYPE_BADGE: Record<string, [string, string]> = {
  whatsapp_template: ['WhatsApp', 'WhatsApp'],
  email: ['Email', 'Email'],
  notify: ['Notification', 'Aviso'],
  webhook: ['Webhook', 'Webhook'],
  tag: ['Tag', 'Etiqueta'],
}
function badges(r: Row) {
  return r.stepTypes.filter((s) => TYPE_BADGE[s]).map((s) => t(TYPE_BADGE[s]![0], TYPE_BADGE[s]![1]))
}
function subline(r: Row) {
  const parts = [triggerTitle(t, r.trigger_event, r.filters)]
  const detail = r.trigger_event === 'segment' ? triggerDetail(t, { ...r, segment: r.segment } as never, lookup.value) : filtersText(t, r.filters, lookup.value)
  if (detail) parts[0] += ` · ${detail}`
  parts.push(t(`${r.stepCount} step${r.stepCount === 1 ? '' : 's'}`, `${r.stepCount} paso${r.stepCount === 1 ? '' : 's'}`))
  if (r.hasConditions) parts.push(t('with conditions', 'con condiciones'))
  return parts
}
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—')
function third(r: Row): { value: string; label: string } {
  const s = stats.value[r.id]
  if (r.dry_run) return { value: String((s?.whatsapp.recorded ?? 0) + (s?.email.recorded ?? 0)), label: t('recorded (test)', 'registrados (prueba)') }
  if (isLeadTrigger(r.trigger_event)) return { value: String(s?.converted ?? 0), label: t('became patients', 'reservaron') }
  if (canReadWhatsApp.value && s?.whatsapp.sent) return { value: pct(s.whatsapp.read, s.whatsapp.sent), label: t('read', 'leídos') }
  if (s?.email.sent) return { value: pct(s.email.opened, s.email.delivered), label: t('emails opened', 'emails abiertos') }
  const sent = (s?.whatsapp.sent ?? 0) + (s?.email.sent ?? 0)
  return { value: sent ? String(sent) : '—', label: sent ? t('sent', 'enviados') : '' }
}

// ---- switching on and off
const toggling = ref<string | null>(null)
const problems = ref<{ ruleId: string; list: Problem[] } | null>(null)
const segmentFor = ref<Row | null>(null)
async function toggle(r: Row) {
  if (lockedLead(r) || toggling.value) return
  if (!r.enabled && r.trigger_event === 'segment') {
    segmentFor.value = r
    return
  }
  toggling.value = r.id
  try {
    await useStaffFetch(`/api/automations/${r.id}/enabled`, { method: 'POST', body: { enabled: !r.enabled } })
    r.enabled = !r.enabled
  } catch (e: any) {
    if (e?.data?.data?.problems) problems.value = { ruleId: r.id, list: e.data.data.problems }
    else showToast(serverMessage(e) ?? t('Could not change it.', 'No se ha podido cambiar.'), 'error')
  } finally {
    toggling.value = null
  }
}
async function activateSegment(testMode: boolean) {
  const r = segmentFor.value
  if (!r) return
  toggling.value = r.id
  try {
    if (testMode && !r.dry_run) {
      const full = await useStaffFetch<{ rule: any; steps: any[] }>(`/api/automations/${r.id}`)
      await useStaffFetch(`/api/automations/${r.id}`, { method: 'PUT', body: { rule: { ...full.rule, dry_run: true }, steps: full.steps, enabled: true } })
    } else {
      await useStaffFetch(`/api/automations/${r.id}/enabled`, { method: 'POST', body: { enabled: true } })
    }
    segmentFor.value = null
    await load()
  } catch (e: any) {
    segmentFor.value = null
    if (e?.data?.data?.problems) problems.value = { ruleId: r.id, list: e.data.data.problems }
    else showToast(serverMessage(e) ?? t('Could not switch it on.', 'No se ha podido activar.'), 'error')
  } finally {
    toggling.value = null
  }
}

const templatesOpen = ref(false)
function onCreated(id: string) {
  templatesOpen.value = false
  router.push(`/automations/${id}`)
}

// The banner about old rules whose waits now wait. Dismissed per viewer: it
// is news once, not a standing warning.
const BANNER_KEY = 'quiroflow-automations-delay-banner'
const bannerHidden = ref(false)
const bannerOpen = ref(false)
onMounted(() => {
  try {
    bannerHidden.value = localStorage.getItem(BANNER_KEY) === '1'
  } catch {
    bannerHidden.value = false
  }
})
function hideBanner() {
  bannerHidden.value = true
  try {
    localStorage.setItem(BANNER_KEY, '1')
  } catch {
    // Private mode: hidden for this visit only.
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-3 border-b border-line bg-surface px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div class="flex min-w-0 flex-col gap-0.5">
        <h1 class="text-[20px] font-bold tracking-tightTitle text-ink-900">{{ t('Automations', 'Automatizaciones') }}</h1>
        <span class="text-[13px] text-ink-muted">{{ t('Messages and tasks that go out on their own: after an appointment, on a birthday, or to a group of patients.', 'Mensajes y tareas que se lanzan solos: tras una cita, en un cumpleaños o a un grupo de pacientes.') }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <UiBtn data-test="open-templates" @click="templatesOpen = true">{{ t('Templates', 'Plantillas') }}</UiBtn>
        <NuxtLink to="/automations/new" class="inline-flex h-9 items-center rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-surface hover:bg-brand-hover touch:h-11" data-test="new-automation">{{ t('New automation', 'Nueva automatización') }}</NuxtLink>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-4 sm:px-6">
      <div class="mx-auto flex max-w-[1160px] flex-col gap-4">
        <div v-if="delayChanged.length && !bannerHidden" class="flex flex-col gap-2 rounded-card border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-warning-text" data-test="delay-banner">
          <div class="flex items-start gap-3">
            <span class="flex-1">
              <strong>{{ t(`${delayChanged.length} older automation${delayChanged.length === 1 ? ' had "Wait" steps that were' : 's had "Wait" steps that were'} not honoured:`, `${delayChanged.length} ${delayChanged.length === 1 ? 'automatización antigua tenía' : 'automatizaciones antiguas tenían'} pasos de «Esperar» que no se cumplían:`) }}</strong>
              {{ t('everything was sent at once. From now on they really wait.', 'todo se enviaba a la vez. Desde ahora esperan de verdad.') }}
              <button type="button" class="font-semibold underline" @click="bannerOpen = !bannerOpen">{{ bannerOpen ? t('Hide', 'Ocultar') : t('See which', 'Ver cuáles') }}</button>
            </span>
            <button type="button" class="shrink-0 text-[12px] font-semibold underline" @click="hideBanner">{{ t('Dismiss', 'Entendido') }}</button>
          </div>
          <ul v-if="bannerOpen" class="flex flex-col gap-1 pl-1">
            <li v-for="r in delayChanged" :key="r.id"><NuxtLink :to="`/automations/${r.id}`" class="underline">{{ r.name }}</NuxtLink></li>
          </ul>
        </div>

        <p v-if="!canReadWhatsApp" class="rounded-ctl border border-line bg-surface-subtle px-3 py-2 text-[12.5px] text-ink-muted">
          {{ t('WhatsApp figures need Inbox access -- ask an owner to turn it on for your role.', 'Las cifras de WhatsApp necesitan acceso a la Bandeja -- pide a un propietario que lo active para tu rol.') }}
        </p>

        <section aria-labelledby="h-list" class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div class="flex flex-wrap items-center gap-2 border-b border-line-divider px-4 py-3">
            <h2 id="h-list" class="mr-2 text-[15px] font-bold text-ink-900">{{ t(`${rules.length} automation${rules.length === 1 ? '' : 's'}`, `${rules.length} automatizaci${rules.length === 1 ? 'ón' : 'ones'}`) }}</h2>
            <button
              v-for="f in FILTERS"
              :key="f.key"
              type="button"
              class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold touch:h-11"
              :class="filter === f.key ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line bg-surface text-ink-700 hover:bg-surface-subtle'"
              :aria-pressed="filter === f.key"
              :data-test="`filter-${f.key}`"
              @click="filter = f.key"
            >{{ f.label }}</button>
            <label class="ml-auto w-full sm:w-64">
              <span class="sr-only">{{ t('Search automations', 'Buscar automatización') }}</span>
              <input v-model="search" type="search" :placeholder="t('Search automations', 'Buscar automatización')" class="h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 focus:border-brand focus:outline-none touch:h-11" data-test="search" />
            </label>
          </div>

          <p v-if="loadError" class="px-4 py-8 text-center text-[13px] text-danger-text">{{ loadError }}</p>
          <div v-else-if="loading" class="flex animate-pulse flex-col" aria-hidden="true">
            <div v-for="i in 4" :key="i" class="h-[72px] border-b border-line-row bg-surface-subtle last:border-0" />
          </div>
          <div v-else-if="rules.length === 0" class="flex flex-col items-center gap-3 px-4 py-12 text-center" data-test="empty">
            <p class="text-[14px] font-semibold text-ink-900">{{ t('No automations yet', 'Aún no hay automatizaciones') }}</p>
            <p class="max-w-md text-[13px] text-ink-muted">{{ t('Start from a template -- a reminder, a win-back, a birthday -- or build one from scratch.', 'Empieza desde una plantilla -- un recordatorio, recuperar pacientes, un cumpleaños -- o créala desde cero.') }}</p>
            <UiBtn variant="primary" data-test="empty-templates" @click="templatesOpen = true">{{ t('Start from a template', 'Empezar desde una plantilla') }}</UiBtn>
          </div>
          <p v-else-if="visible.length === 0" class="px-4 py-8 text-center text-[13px] text-ink-muted">{{ t('No automation matches.', 'Ninguna automatización coincide.') }}</p>

          <div v-for="r in visible" :key="r.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-row px-4 py-3 last:border-0" :data-test="`rule-${r.id}`">
            <button
              type="button"
              role="switch"
              :aria-checked="isActive(r)"
              :aria-label="t('Active', 'Activa')"
              :disabled="lockedLead(r) || toggling === r.id"
              :title="lockedLead(r) ? t('Lead automations need Growth', 'Las automatizaciones de leads necesitan Growth') : undefined"
              class="relative h-[26px] w-11 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50"
              :class="isActive(r) ? 'bg-brand' : 'bg-line-control'"
              data-test="rule-toggle"
              @click="toggle(r)"
            >
              <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="isActive(r) ? 'left-[21px]' : 'left-[3px]'" />
            </button>
            <NuxtLink :to="`/automations/${r.id}`" class="flex min-w-0 flex-1 flex-col gap-1" data-test="rule-link">
              <span class="flex flex-wrap items-center gap-1.5">
                <strong class="truncate text-[14px] text-ink-900">{{ r.name }}</strong>
                <UiPill v-if="isLeadTrigger(r.trigger_event)" tone="brand" data-test="badge-growth">Growth</UiPill>
                <UiPill v-for="bdg in badges(r)" :key="bdg" tone="neutral">{{ bdg }}</UiPill>
                <UiPill v-if="r.is_marketing" tone="warning">{{ t('Marketing', 'Marketing') }}</UiPill>
                <UiPill v-if="r.dry_run" tone="info" data-test="badge-test">{{ t('Test mode', 'Modo prueba') }}</UiPill>
                <UiPill v-if="lockedLead(r)" tone="neutral">{{ t('Paused · no Growth', 'Pausada · sin Growth') }}</UiPill>
              </span>
              <span class="truncate text-[12.5px] text-ink-muted">{{ subline(r).join(' · ') }}</span>
            </NuxtLink>
            <div class="grid shrink-0 grid-cols-3 gap-4 text-left sm:w-[330px]" data-test="rule-stats">
              <span class="flex flex-col">
                <strong class="font-mono text-[14px] text-ink-900" data-test="stat-inside">{{ r.usesRuns ? (stats[r.id]?.inside ?? 0) : '—' }}</strong>
                <span class="text-[11px] text-ink-muted">{{ t('inside now', 'dentro ahora') }}</span>
              </span>
              <span class="flex flex-col">
                <strong class="font-mono text-[14px] text-ink-900" data-test="stat-entered">{{ stats[r.id]?.entered ?? 0 }}</strong>
                <span class="text-[11px] text-ink-muted">{{ t('entered · 30 days', 'entraron · 30 días') }}</span>
              </span>
              <span class="flex flex-col">
                <strong class="font-mono text-[14px]" :class="stats[r.id]?.failedRuns ? 'text-danger-text' : 'text-ink-900'" data-test="stat-third">{{ third(r).value }}</strong>
                <span class="text-[11px] text-ink-muted">{{ stats[r.id]?.failedRuns ? t(`${stats[r.id]!.failedRuns} failed`, `${stats[r.id]!.failedRuns} con fallo`) : third(r).label }}</span>
              </span>
            </div>
            <NuxtLink :to="`/automations/${r.id}`" class="hidden text-ink-faint hover:text-ink-700 sm:block" :aria-label="t('Open', 'Abrir')">›</NuxtLink>
          </div>
        </section>
      </div>
    </div>

    <AutomationsTemplatesDialog v-if="templatesOpen" :existing-names="rules.map((r) => r.name)" :has-growth="hasGrowth" @close="templatesOpen = false" @created="onCreated" />
    <AutomationsProblemsDialog
      v-if="problems"
      :problems="problems.list"
      :draft-label="t('Open it', 'Abrirla')"
      @draft="router.push(`/automations/${problems.ruleId}`)"
      @review="problems = null"
      @goto="(id) => router.push(`/automations/${problems!.ruleId}${id ? `?step=${id}` : ''}`)"
    />
    <AutomationsSegmentActivateDialog
      v-if="segmentFor"
      :filters="segmentFor.segment?.filters ?? {}"
      :is-marketing="segmentFor.is_marketing"
      :schedule="segmentFor.segment?.schedule"
      :rule-id="segmentFor.id"
      entry-mode="once_ever"
      :busy="!!toggling"
      @activate="activateSegment"
      @cancel="segmentFor = null"
    />
  </div>
</template>
