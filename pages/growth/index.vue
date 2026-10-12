<script setup lang="ts">
import { SAMPLE_GROWTH_DASHBOARD } from '~/composables/useGrowthDashboard'

const t = useT()
const { can } = usePermission()
const store = useAccountStore()
const { hasGrowth, resolved } = useGrowthTier()
// Decided once the tier has resolved against a loaded account; before that a
// "no" may only mean the bootstrap has not landed yet.
const decided = computed(() => resolved.value && store.loaded)
const { data, loading, error, saveChannelSpend } = useGrowthDashboard(() => (decided.value ? hasGrowth.value : null))
const sample = useGrowthDashboardView(() => SAMPLE_GROWTH_DASHBOARD)

// What the figures cover, said once in the header. It used to read
// "Acquisition across 3 locations" for every clinic, beside two chips --
// "Month to date", "All locations" -- styled as filters that did nothing.
// Every clinic of the account is counted and the month is fixed, so that
// is stated rather than offered as a choice.
const meta = computed(() => {
  if (!data.value || !hasGrowth.value) return undefined
  const n = store.clinics.length
  const scope = n > 1
    ? t(`All ${n} locations`, `Los ${n} centros`)
    : t('Acquisition', 'Captación')
  return `${scope} · ${t('Month to date', 'Mes en curso')} · ${data.value.periodLabel}`
})

// Reuses communication_config, the key that already gates Campaigns, rather
// than introducing a growth_access key. A new permission defaults to
// owner-only until someone visits Settings > Roles to grant it, which would
// hide the whole tier from every non-owner the day it ships -- the same trap
// the Waitlist nav item documents.
const allowed = computed(() => can('communication_config'))
</script>

<template>
  <PageHeader :title="t('Growth dashboard', 'Panel de crecimiento')" :meta="meta" />

  <div class="flex-1 overflow-y-auto">
    <div class="p-4 sm:p-6">
      <div v-if="!allowed" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">
          {{ t("You don't have access to Growth.", 'No tienes acceso a Crecimiento.') }}
        </p>
      </div>

      <GrowthDashboardSkeleton v-else-if="!decided" />

      <template v-else-if="hasGrowth">
        <p v-if="error" class="py-16 text-center text-[13px] text-danger-text" data-test="dashboard-error">{{ error }}</p>
        <GrowthDashboardSkeleton v-else-if="loading || !data" />
        <GrowthDashboardBody v-else :data="data" @save-spend="saveChannelSpend" />
      </template>

      <!-- Locked: the real dashboard body out of focus behind the upgrade
      card, rather than a separate mock that can drift from it -- fed sample
      figures, since without Growth the endpoint has none to give. inert keeps
      its links out of the tab order, so the only reachable controls are the
      card's own. -->
      <div v-else class="flex flex-col gap-4" data-test="growth-locked">
        <div class="relative isolate overflow-hidden rounded-card">
          <div inert aria-hidden="true" class="pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden blur-[5px]">
            <GrowthDashboardBody v-if="sample" :data="sample" />
          </div>
          <div aria-hidden="true" class="absolute inset-0 -z-10 bg-surface-page/50" />
          <div class="flex justify-center px-2 py-8 sm:px-4">
            <GrowthUpgradePanel />
          </div>
        </div>
        <GrowthPlanComparison />
      </div>
    </div>
  </div>
</template>
