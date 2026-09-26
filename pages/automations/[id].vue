<script setup lang="ts">
import { BUILDER_KEY, useAutomationBuilder } from '~/composables/useAutomationBuilder'
import { OUTLETS } from '~/utils/automationCatalog'
import { stepTitle } from '~/utils/automationDescribe'
import { chainOf, type Problem } from '~/utils/automationTree'

// One automation: the canvas (Flow), who is in it (People), what it did
// (History) and its settings. One draft for all four, one Save.
//
// /automations/new is the same page with nothing saved yet.

useHead({ title: 'Automation' })
// One instance for every id: the first save of a new automation moves the URL
// from /new to its id, and a remount there would throw away the draft that
// was just saved and render the header against an empty one until it reloads.
// Moving between two automations is handled by the idParam watch below.
definePageMeta({ key: 'automation-builder' })

const t = useT()
const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

const b = useAutomationBuilder()
provide(BUILDER_KEY, b)

const idParam = computed(() => String(route.params.id))
const wide = useMediaQuery('(min-width: 1200px)')
const phone = useMediaQuery('(max-width: 639px)')

type Tab = 'flow' | 'people' | 'history' | 'settings'
const tab = computed<Tab>(() => (['people', 'history', 'settings'].includes(String(route.query.tab)) ? (route.query.tab as Tab) : 'flow'))
function setTab(next: Tab) {
  router.replace({ query: { ...route.query, tab: next === 'flow' ? undefined : next, run: undefined } })
}

async function init() {
  b.loadLookups()
  b.loadTemplates()
  if (idParam.value === 'new') b.initNew()
  else await b.load(idParam.value)
  if (typeof route.query.step === 'string' && b.stepsById.value.has(route.query.step)) b.selection.value = { kind: 'step', id: route.query.step }
}
onMounted(async () => {
  await init()
  // On a tablet the panel is a sheet over the canvas: start with it closed.
  if (!wide.value && !route.query.step) b.selection.value = null
})
// Saving a new automation moves the URL to its id; that is the same draft.
watch(idParam, (id) => {
  if (id === 'new') {
    if (b.ruleId.value) b.initNew()
  } else if (id !== b.ruleId.value) {
    b.load(id)
  }
})

// ---- saving
const people = ref<{ stepId: string; actionType: string; count: number }[] | null>(null)
const problems = ref<Problem[] | null>(null)
let pending: { enabled?: boolean } = {}
const removedTitles = ref<Record<string, string>>({})

async function saveWith(opts: { enabled?: boolean; removedPolicy?: 'move_on' | 'take_out' } = {}) {
  const wasNew = b.isNew.value
  const result = await b.save(opts)
  if (result.ok) {
    people.value = null
    problems.value = null
    showToast(t('Saved', 'Guardado'))
    if (wasNew && b.ruleId.value) router.replace({ path: `/automations/${b.ruleId.value}`, query: route.query })
    return true
  }
  if ('people' in result) {
    pending = { enabled: opts.enabled }
    removedTitles.value = Object.fromEntries(result.people.map((p) => [p.stepId, originalTitle(p.stepId) ?? '']))
    people.value = result.people
  } else if ('problems' in result) {
    pending = { enabled: opts.enabled }
    problems.value = result.problems
  } else {
    showToast(result.error, 'error')
  }
  return false
}
function originalTitle(stepId: string) {
  const saved = b.savedStep(stepId)
  return saved ? stepTitle(t, saved, b.lookup.value) : null
}
function confirmRemoved(policy: 'move_on' | 'take_out') {
  saveWith({ ...pending, removedPolicy: policy })
}
function saveAsDraft() {
  problems.value = null
  saveWith({ enabled: false })
}
function gotoStep(stepId: string | null) {
  problems.value = null
  setTab('flow')
  b.selection.value = stepId ? { kind: 'step', id: stepId } : { kind: 'trigger' }
}

// ---- switching on and off
const segmentDialog = ref(false)
async function toggleEnabled() {
  const target = !b.draft.value.enabled
  if (target && b.draft.value.rule.trigger_event === 'segment') {
    segmentDialog.value = true
    return
  }
  if (b.isNew.value || b.dirty.value) return saveWith({ enabled: target })
  try {
    await useStaffFetch(`/api/automations/${b.ruleId.value}/enabled`, { method: 'POST', body: { enabled: target } })
    b.draft.value.enabled = target
    await b.load(b.ruleId.value!)
    showToast(target ? t('Switched on', 'Activada') : t('Paused', 'Pausada'))
  } catch (e: any) {
    if (e?.data?.data?.problems) problems.value = e.data.data.problems
    else showToast(t('Could not change it.', 'No se ha podido cambiar.'), 'error')
  }
}
async function activateSegment(testMode: boolean) {
  segmentDialog.value = false
  if (testMode) b.updateRule({ dry_run: true })
  await saveWith({ enabled: true })
}

// ---- the other dialogs
const sendTestOpen = ref(false)
const launchOpen = ref(false)
const deleteOpen = ref(false)
function onDeleted() {
  deleteOpen.value = false
  leavingOnPurpose = true
  router.push('/automations')
}

// ---- leaving with unsaved changes
let leavingOnPurpose = false
const leaveTo = ref<string | null>(null)
onBeforeRouteLeave((to) => {
  if (leavingOnPurpose || !b.dirty.value || leaveTo.value === to.fullPath) return true
  // Same page, new id: the first save of a new automation.
  if (to.path === `/automations/${b.ruleId.value}`) return true
  leaveTo.value = to.fullPath
  return false
})
function leaveAnyway() {
  const to = leaveTo.value
  leavingOnPurpose = true
  if (to) router.push(to)
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (b.dirty.value) e.preventDefault()
}
function onKeydown(e: KeyboardEvent) {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (b.dirty.value || b.isNew.value) saveWith()
  } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && tab.value === 'flow') {
    e.preventDefault()
    b.undo()
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('keydown', onKeydown)
})

// ---- header
const statusLabel = computed(() => {
  if (b.isLead.value && !b.hasGrowth.value) return t('Paused · no Growth', 'Pausada · sin Growth')
  if (b.isNew.value) return t('Draft', 'Borrador')
  return b.draft.value.enabled ? t('Active', 'Activa') : t('Paused', 'Pausada')
})
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => (clock = setInterval(() => (now.value = Date.now()), 30_000)))
onUnmounted(() => clearInterval(clock))
const savedText = computed(() => {
  if (!b.savedAt.value) return ''
  const min = Math.floor((now.value - b.savedAt.value) / 60_000)
  return min < 1 ? t('Saved just now', 'Guardado ahora') : t(`Saved ${min} min ago`, `Guardado hace ${min} min`)
})
const inside = computed(() => b.stats.value.rule?.inside ?? 0)

// A phone gets the steps as a list to read, not a canvas to edit.
const outline = computed(() => {
  const rows: { id: string; depth: number; label: string; branch: string | null }[] = []
  const walk = (parentId: string | null, branch: string | null, depth: number) => {
    for (const s of chainOf(b.draft.value.steps, parentId, branch)) {
      rows.push({ id: s.id, depth, label: stepTitle(t, s, b.lookup.value), branch: s.position === 0 ? branch : null })
      const outlets = OUTLETS[s.action_type]
      if (outlets) for (const o of outlets) walk(s.id, o, depth + 1)
    }
  }
  walk(null, null, 0)
  return rows
})
const sheetOpen = computed(() => !wide.value && b.selection.value !== null && tab.value === 'flow')
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col bg-surface-page">
    <p v-if="b.missing.value" class="p-6 text-[14px] text-ink-muted" data-test="automation-missing">
      {{ t('This automation does not exist, or is not yours.', 'Esta automatización no existe o no es tuya.') }}
      <NuxtLink to="/automations" class="text-brand-text hover:underline">{{ t('Back to automations', 'Volver a automatizaciones') }}</NuxtLink>
    </p>
    <p v-else-if="b.loadError.value" class="p-6 text-[14px] text-danger-text">{{ b.loadError.value }}</p>

    <template v-else>
      <header class="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5 sm:px-5">
        <NuxtLink to="/automations" class="flex h-9 w-9 items-center justify-center rounded-ctl border border-line-control text-ink-700 hover:bg-surface-subtle touch:h-11 touch:w-11" :aria-label="t('Back to automations', 'Volver a Automatizaciones')" data-test="back">‹</NuxtLink>
        <input
          :value="b.draft.value.rule.name"
          class="h-9 min-w-0 flex-1 rounded-ctl border border-transparent bg-transparent px-2 text-[16px] font-bold text-ink-900 hover:border-line-control focus:border-brand focus:outline-none sm:max-w-[420px] touch:h-11"
          :aria-label="t('Automation name', 'Nombre de la automatización')"
          data-test="automation-name"
          @input="b.updateRule({ name: ($event.target as HTMLInputElement).value })"
        />
        <button
          type="button"
          role="switch"
          :aria-checked="b.draft.value.enabled"
          :disabled="!b.loaded.value || (b.isLead.value && !b.hasGrowth.value) || b.saving.value"
          class="flex h-8 items-center gap-2 rounded-pill border px-2.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 touch:h-11"
          :class="b.draft.value.enabled && !(b.isLead.value && !b.hasGrowth.value) ? 'border-success-border bg-success-bg text-success-text' : 'border-chip-border bg-chip-bg text-chip-text'"
          data-test="automation-enabled"
          @click="toggleEnabled"
        >
          <span class="h-2 w-2 rounded-full" :class="b.draft.value.enabled ? 'bg-success-accent' : 'bg-ink-faint3'" />
          {{ statusLabel }}
        </button>
        <UiPill v-if="b.draft.value.rule.dry_run" tone="info">{{ t('Test mode', 'Modo prueba') }}</UiPill>
        <span class="ml-auto hidden text-[12px] text-ink-muted md:inline" data-test="saved-at">{{ b.dirty.value ? t('Unsaved changes', 'Cambios sin guardar') : savedText }}</span>
        <UiBtn class="hidden sm:inline-flex" data-test="send-test" @click="sendTestOpen = true">{{ t('Send test', 'Enviar prueba') }}</UiBtn>
        <UiBtn variant="primary" :disabled="(!b.dirty.value && !b.isNew.value) || b.saving.value" data-test="save" @click="saveWith()">{{ b.saving.value ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
      </header>

      <nav role="tablist" class="flex shrink-0 gap-1 border-b border-line bg-surface px-4 sm:px-5">
        <button
          v-for="x in [
            { key: 'flow', label: t('Flow', 'Flujo') },
            { key: 'people', label: inside ? `${t('People', 'Personas')} · ${inside}` : t('People', 'Personas') },
            { key: 'history', label: t('History', 'Historial') },
            { key: 'settings', label: t('Settings', 'Ajustes') },
          ]"
          :key="x.key"
          type="button"
          role="tab"
          :aria-selected="tab === x.key"
          :disabled="x.key !== 'flow' && x.key !== 'settings' && b.isNew.value"
          class="-mb-px h-10 border-b-2 px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 touch:h-11"
          :class="tab === x.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
          :data-test="`tab-${x.key}`"
          @click="setTab(x.key as 'flow')"
        >{{ x.label }}</button>
      </nav>

      <div v-if="!b.loaded.value" class="flex-1 animate-pulse bg-surface-page" aria-hidden="true" />

      <template v-else-if="tab === 'flow'">
        <p v-if="b.delayNowWaits.value" class="shrink-0 border-b border-warning-border bg-warning-bg px-5 py-2 text-[12.5px] text-warning-text" data-test="delay-note">
          {{ t('Before, the "Wait" steps of this automation were ignored and everything was sent at once. Now they really wait.', 'Antes, los pasos de «Esperar» de esta automatización se ignoraban y todo se enviaba a la vez. Ahora esperan de verdad.') }}
        </p>
        <div v-if="phone" class="flex-1 overflow-y-auto p-4" data-test="flow-outline">
          <p class="mb-3 text-[12.5px] text-ink-muted">{{ t('On a phone, automations are shown as a list of steps. Edit them on a tablet or computer.', 'En el móvil las automatizaciones se ven como lista de pasos. Edítalas en una tablet o un ordenador.') }}</p>
          <ol class="flex flex-col gap-1.5">
            <li v-for="row in outline" :key="row.id" class="rounded-ctl border border-line bg-surface px-3 py-2 text-[13px] text-ink-900" :style="{ marginLeft: `${row.depth * 16}px` }">
              <span v-if="row.branch" class="mr-1 text-[11px] font-semibold text-ink-muted">{{ row.branch === 'yes' ? t('Yes', 'Sí') : row.branch === 'no' ? 'No' : row.branch === 'met' ? '✓' : '⏱' }} ·</span>{{ row.label }}
            </li>
          </ol>
        </div>
        <div v-else class="relative flex min-h-0 flex-1">
          <div class="relative min-w-0 flex-1">
            <AutomationsFlowCanvas :popover-menu="wide" />
          </div>
          <aside v-if="wide && b.selection.value" class="w-[400px] shrink-0 border-l border-line bg-surface" :aria-label="t('Selected step', 'Paso seleccionado')">
            <AutomationsInspector @close="b.selection.value = null" />
          </aside>
          <div
            v-if="sheetOpen"
            role="dialog"
            :aria-label="t('Selected step', 'Paso seleccionado')"
            class="absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] flex-col rounded-t-[16px] border-t border-line bg-surface shadow-popover"
            data-test="inspector-sheet"
          >
            <span class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-control" aria-hidden="true" />
            <AutomationsInspector sheet @close="b.selection.value = null" />
          </div>
        </div>
      </template>

      <AutomationsPeopleTab
        v-else-if="tab === 'people'"
        :initial-run-id="typeof route.query.run === 'string' ? route.query.run : null"
        @changed="b.ruleId.value && b.load(b.ruleId.value)"
        @open-run="(id) => router.replace({ query: { ...route.query, run: id ?? undefined } })"
      />
      <AutomationsHistoryTab v-else-if="tab === 'history'" />
      <AutomationsSettingsTab v-else-if="tab === 'settings'" @send-test="sendTestOpen = true" @launch="launchOpen = true" @toggle-enabled="toggleEnabled" @remove="deleteOpen = true" />

      <!-- One save for the whole automation. -->
      <div
        v-if="b.dirty.value"
        role="region"
        :aria-label="t('Unsaved changes', 'Cambios sin guardar')"
        class="absolute bottom-5 left-1/2 z-30 flex w-[min(600px,calc(100%-32px))] -translate-x-1/2 items-center gap-2.5 rounded-card bg-ink-900 py-2.5 pl-5 pr-2.5 text-surface-page shadow-popover"
        :class="sheetOpen ? 'hidden' : ''"
        data-test="save-bar"
      >
        <span class="flex-1 text-[13.5px] font-semibold">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
        <button type="button" class="h-9 rounded-ctl border border-surface-page/30 px-3.5 text-[13px] font-semibold touch:h-11" data-test="discard" @click="b.discard()">{{ t('Discard', 'Descartar') }}</button>
        <button type="button" :disabled="b.saving.value" class="h-9 rounded-ctl bg-brand px-4 text-[13px] font-bold text-surface disabled:opacity-70 touch:h-11" data-test="save-bar-save" @click="saveWith()">
          {{ b.saving.value ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}
        </button>
      </div>
    </template>

    <AutomationsRemovedStepsDialog v-if="people" :people="people" :titles="removedTitles" :busy="b.saving.value" @confirm="confirmRemoved" @cancel="people = null" />
    <AutomationsProblemsDialog
      v-if="problems"
      :problems="problems"
      :draft-label="b.dirty.value || b.isNew.value ? null : t('Keep it paused', 'Dejarla pausada')"
      :busy="b.saving.value"
      @draft="b.dirty.value || b.isNew.value ? saveAsDraft() : (problems = null)"
      @review="gotoStep(problems![0]?.stepId ?? null)"
      @goto="gotoStep"
    />
    <AutomationsSegmentActivateDialog
      v-if="segmentDialog"
      :filters="b.draft.value.rule.segment?.filters ?? {}"
      :is-marketing="b.draft.value.rule.is_marketing"
      :schedule="b.draft.value.rule.segment?.schedule"
      :rule-id="b.ruleId.value"
      :entry-mode="b.draft.value.rule.entry_mode"
      :busy="b.saving.value"
      @activate="activateSegment"
      @cancel="segmentDialog = false"
    />
    <AutomationsSendTestDialog v-if="sendTestOpen" @close="sendTestOpen = false" />
    <AutomationsLaunchDialog v-if="launchOpen && b.ruleId.value" :rule-id="b.ruleId.value" @close="launchOpen = false" @launched="launchOpen = false" />
    <AutomationsDeleteDialog v-if="deleteOpen && b.ruleId.value" :rule-id="b.ruleId.value" :name="b.draft.value.rule.name" :inside="inside" @deleted="onDeleted" @cancel="deleteOpen = false" />
    <UiConfirmDialog
      v-if="leaveTo"
      :title="t('Leave without saving?', '¿Salir sin guardar?')"
      :confirm-label="t('Leave without saving', 'Salir sin guardar')"
      :cancel-label="t('Stay', 'Quedarme')"
      @confirm="leaveAnyway"
      @cancel="leaveTo = null"
    >
      <p class="text-[14px] leading-relaxed text-ink-500" data-test="leave-summary">
        {{ b.changedStepCount.value
          ? t(`You have changes in ${b.changedStepCount.value} step${b.changedStepCount.value === 1 ? '' : 's'} that will be lost.`, `Tienes cambios en ${b.changedStepCount.value} paso${b.changedStepCount.value === 1 ? '' : 's'} que se perderán.`)
          : t('Your changes will be lost.', 'Tus cambios se perderán.') }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
