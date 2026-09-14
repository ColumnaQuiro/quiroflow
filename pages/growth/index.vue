<script setup lang="ts">
const t = useT()
const { can } = usePermission()
const { hasGrowth, resolved } = useGrowthTier()
const { data, loading, error } = useGrowthDashboard()

// Reuses communication_config, the key that already gates Campaigns, rather
// than introducing a growth_access key. A new permission defaults to
// owner-only until someone visits Settings > Roles to grant it, which would
// hide the whole tier from every non-owner the day it ships -- the same trap
// the Waitlist nav item documents.
const allowed = computed(() => can('communication_config'))
</script>

<template>
  <PageHeader
    :title="t('Growth dashboard', 'Panel de crecimiento')"
    :meta="data && hasGrowth ? `${t('Acquisition across 3 locations', 'Captación en 3 centros')} · ${data.periodLabel}` : undefined"
  >
    <template v-if="hasGrowth">
      <span class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-[11px] text-[12px] text-ink-500">
        {{ t('Month to date', 'Mes en curso') }}
      </span>
      <span class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-[11px] text-[12px] text-ink-500">
        {{ t('All locations', 'Todos los centros') }}
      </span>
    </template>
  </PageHeader>

  <div class="flex-1 overflow-y-auto">
    <div class="p-4 sm:p-6">
      <div v-if="!allowed" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">
          {{ t("You don't have access to Growth.", 'No tienes acceso a Crecimiento.') }}
        </p>
      </div>

      <p v-else-if="error" class="py-16 text-center text-[13px] text-danger-text" data-test="dashboard-error">{{ error }}</p>

      <GrowthDashboardSkeleton v-else-if="!resolved || loading || !data" />

      <GrowthDashboardBody v-else-if="hasGrowth" :data="data" />

      <!-- Locked: the real dashboard out of focus behind the upgrade card,
      rather than a separate mock that can drift from it. inert keeps its
      links out of the tab order, so the only reachable controls are the
      card's own. -->
      <div v-else class="flex flex-col gap-4" data-test="growth-locked">
        <div class="relative isolate overflow-hidden rounded-card">
          <div inert aria-hidden="true" class="pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden blur-[5px]">
            <GrowthDashboardBody :data="data" />
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
