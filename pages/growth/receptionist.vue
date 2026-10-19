<script setup lang="ts">
import type { ReceptionistIncludedBy } from '~/composables/useGrowthReceptionist'

// Growth > AI receptionist: what it does, what it knows, how it behaves,
// and a place to try it.
//
// It used to be nine cards down one long page, with the on/off switch
// first, the billing card second and the booking rules read-only. Now four
// sections: an Overview that says in one sentence what it is doing right
// now and what it has done, two sections of settings grouped by what they
// are (facts it repeats; rules it follows), and the test panel, which sits
// beside the settings on a wide screen -- change a rule, try it without
// scrolling back -- and is a section of its own on a phone.
//
// The data model and endpoint are the ones the old page used; only the way
// in changed.

const t = useT()
const { can } = usePermission()
const { hasReceptionist, resolved } = useGrowthTier()
const { config, channels, appointmentTypes, offeredTypes, testModelAvailable, repliesThisMonth, includedBy, activity, loading, saving, error, save, reload, liveChannelCount } = useGrowthReceptionist()
const route = useRoute()
const router = useRouter()

type Tab = 'overview' | 'knowledge' | 'behaviour' | 'try'
const TABS: Tab[] = ['overview', 'knowledge', 'behaviour', 'try']
const tabs = computed<{ key: Tab; label: string; narrowOnly?: boolean }[]>(() => [
  { key: 'overview', label: t('Overview', 'Resumen') },
  { key: 'knowledge', label: t('What it knows', 'Lo que sabe') },
  { key: 'behaviour', label: t('How it behaves', 'Cómo actúa') },
  // On a wide screen the test panel is always beside the settings, so the
  // tab for it only exists where there is no room for that.
  { key: 'try', label: t('Try it', 'Pruébala'), narrowOnly: true },
])

// The section is in the URL, so a link from elsewhere (the appointment type
// page's "Where it is used" points at #bookable-types) lands on the right
// one, and a reload keeps it.
const tab = ref<Tab>(initialTab())
function initialTab(): Tab {
  if (route.hash === '#bookable-types') return 'behaviour'
  const q = route.query.tab
  return typeof q === 'string' && (TABS as string[]).includes(q) ? (q as Tab) : 'overview'
}
function show(next: Tab) {
  tab.value = next
  router.replace({ query: { ...route.query, tab: next === 'overview' ? undefined : next }, hash: next === 'behaviour' ? route.hash : '' })
}

// Linked from each appointment type's own page ("Where it is used"). The
// section only exists once the config has loaded, so the browser's own jump
// to the hash has nothing to land on; this does it when there is.
watch(
  () => Boolean(config.value) && tab.value === 'behaviour' && route.hash === '#bookable-types',
  async (ready) => {
    if (!ready) return
    await nextTick()
    document.getElementById('bookable-types')?.scrollIntoView({ block: 'start' })
  },
  { immediate: true },
)

const allowed = computed(() => can('communication_config'))

// The checklist's "tried it": sent a test message this session.
const tried = ref(false)

// One sentence for the mode, derived from the three columns the tick reads
// -- never stored as prose, so it cannot go stale.
const modeSentence = computed(() => {
  const c = config.value
  if (!c) return ''
  if (!c.enabled) return t('Off', 'Desactivada')
  if (c.afterHours && c.answerDuringHours) return t('Answering on its own, day and night', 'Contesta sola, de día y de noche')
  if (c.afterHours) return t('Answering on its own outside clinic hours, drafting during', 'Contesta sola fuera del horario, redacta en horario')
  if (c.answerDuringHours) return t('Answering on its own during clinic hours, drafting outside', 'Contesta sola en horario, redacta fuera')
  return t('Drafting replies for you to approve', 'Redacta respuestas para que las apruebes')
})

const INCLUDED: Record<NonNullable<ReceptionistIncludedBy>, { en: string; es: string }> = {
  comped: { en: 'No charge', es: 'Sin cargo' },
  trial: { en: 'In your trial', es: 'En tu prueba' },
  growth: { en: 'Included in Growth', es: 'Incluida en Growth' },
  addon: { en: 'Add-on', es: 'Complemento' },
}
const includedLabel = computed(() => (includedBy.value ? t(INCLUDED[includedBy.value].en, INCLUDED[includedBy.value].es) : null))
</script>

<template>
  <PageHeader
    :title="t('AI receptionist', 'Recepcionista IA')"
    :meta="t('Answers enquiries, qualifies them, and offers appointment times', 'Responde consultas, las cualifica y ofrece horarios de cita')"
  >
    <NuxtLink v-if="includedLabel" to="/subscription" class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] font-medium text-ink-muted hover:border-line-controlHover" data-test="receptionist-included-by">
      {{ includedLabel }}
    </NuxtLink>
    <span
      v-if="config"
      class="flex h-8 items-center gap-1.5 rounded-ctl border px-2.5 text-[12px] font-medium"
      :class="config.enabled ? 'border-success-border bg-success-bg text-success-text' : 'border-chip-border bg-chip-bg text-ink-muted'"
      data-test="receptionist-status"
    >
      <span class="h-1.5 w-1.5 rounded-full" :class="config.enabled ? 'bg-success-accent' : 'bg-toggle-off'" />
      {{ config.enabled ? `${t('On', 'Activa')} · ${liveChannelCount} ${liveChannelCount === 1 ? t('channel', 'canal') : t('channels', 'canales')}` : t('Off', 'Desactivada') }}
    </span>
  </PageHeader>

  <div class="flex-1 overflow-y-auto">
    <div class="p-4 sm:p-6">
      <div v-if="!allowed" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">{{ t("You don't have access to Growth.", 'No tienes acceso a Crecimiento.') }}</p>
      </div>

      <div v-else-if="resolved && !hasReceptionist" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">{{ t('Add the AI receptionist on its own, or get it with Growth.', 'Añade la recepcionista IA por sí sola, o consíguela con Growth.') }}</p>
        <div class="mt-3 flex flex-wrap justify-center gap-2">
          <NuxtLink to="/subscription" class="inline-flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover">
            {{ t('Add the receptionist', 'Añadir la recepcionista') }}
          </NuxtLink>
          <NuxtLink to="/growth" class="inline-flex h-9 items-center rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-semibold text-ink-700 hover:border-line-controlHover">
            {{ t('See what Growth adds', 'Ver qué añade Growth') }}
          </NuxtLink>
        </div>
      </div>

      <p v-else-if="error" class="py-16 text-center text-[13px] text-danger-text" data-test="receptionist-error">{{ error }}</p>

      <div v-else-if="loading || !config" class="grid animate-pulse gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" aria-hidden="true">
        <div class="h-[520px] rounded-card border border-line bg-surface shadow-card" />
        <div class="h-[420px] rounded-card border border-line bg-surface shadow-card" />
      </div>

      <div v-else class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div class="flex min-w-0 flex-col gap-4">
          <div role="tablist" class="flex gap-1 overflow-x-auto border-b border-line" data-test="receptionist-tabs">
            <button
              v-for="tb in tabs"
              :key="tb.key"
              type="button"
              role="tab"
              :aria-selected="tab === tb.key"
              :data-test="`receptionist-tab-${tb.key}`"
              class="-mb-px flex h-10 shrink-0 items-center border-b-2 px-3 text-[12.5px] font-semibold"
              :class="[
                tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700',
                tb.narrowOnly ? 'lg:hidden' : '',
              ]"
              @click="show(tb.key)"
            >{{ tb.label }}</button>
          </div>

          <!-- Overview: what it is doing now, what is left to set up, what
          it has done, and what the month costs. -->
          <template v-if="tab === 'overview'">
            <p class="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-700" data-test="receptionist-mode-sentence">
              <span class="text-[10.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Right now', 'Ahora mismo') }}</span>
              <span class="font-semibold text-ink-900">{{ modeSentence }}</span>
            </p>
            <GrowthReceptionistChecklist :config="config" :offered-types="offeredTypes" :live-channel-count="liveChannelCount" :tried="tried" @go="show" />
            <GrowthReceptionistModeCard :config="config" :channels="channels" :saving="saving" :save="save" />
            <GrowthReceptionistActivity :activity="activity" @reload="reload" />
            <GrowthReceptionistUsage
              :replies="repliesThisMonth"
              :limit="config.monthlyReplyLimit"
              :saving="saving"
              :save="(limit: number | null) => save({ monthlyReplyLimit: limit })"
            />
          </template>

          <!-- What it knows: who it is and the facts it repeats. -->
          <template v-else-if="tab === 'knowledge'">
            <GrowthReceptionistPersonaCard :config="config" :saving="saving" :save="save" />
            <GrowthReceptionistKnowledgeCard :config="config" :saving="saving" :save="save" />
            <GrowthReceptionistNoReplyCard :config="config" :saving="saving" :save="save" />
          </template>

          <!-- How it behaves: what it asks, when it stops, what it books. -->
          <template v-else-if="tab === 'behaviour'">
            <GrowthReceptionistQuestionsCard :config="config" :saving="saving" :save="save" />
            <GrowthReceptionistEscalationCard :config="config" :saving="saving" :save="save" />
            <GrowthReceptionistBookingRulesCard :config="config" :offered-types="offeredTypes" :saving="saving" :save="save" />
            <GrowthBookableTypesEditor
              :types="appointmentTypes"
              :selected-ids="config.bookableAppointmentTypeIds"
              :offered="offeredTypes"
              :saving="saving"
              :save="(ids: string[]) => save({ bookableAppointmentTypeIds: ids })"
            />
          </template>

          <!-- The test panel as a section, where the screen is too narrow
          to show it beside the settings. -->
          <GrowthReceptionistTestChat v-else-if="tab === 'try'" class="lg:hidden" :available="testModelAvailable" :persona-name="config.personaName" fill @tried="tried = true" />
        </div>

        <GrowthReceptionistTestChat class="hidden lg:flex" :available="testModelAvailable" :persona-name="config.personaName" @tried="tried = true" />
      </div>
    </div>
  </div>
</template>
