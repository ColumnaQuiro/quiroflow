<script setup lang="ts">
const t = useT()
const { can } = usePermission()
const { hasGrowth, resolved } = useGrowthTier()
const {
  workflows,
  activeWorkflow,
  activeWorkflowId,
  selectWorkflow,
  nodes,
  edgePaths,
  loading,
  error,
  selectedNode,
  selectedConfig,
  selectedNodeId,
  selectNode,
} = useGrowthAutomations()

const allowed = computed(() => can('communication_config'))
</script>

<template>
  <PageHeader
    :title="activeWorkflow?.name ?? t('Automations', 'Automatizaciones')"
    :meta="activeWorkflow ? `${t('Automations', 'Automatizaciones')} · ${activeWorkflow.runs}` : t('Built in Campaigns', 'Se crean en Campañas')"
  >
    <!-- A rule that records instead of sending is neither enabled nor
    paused, and saying "Enabled" for one would be the single most
    misleading word on this screen. -->
    <span
      v-if="activeWorkflow?.dryRun"
      class="flex h-8 items-center gap-1.5 rounded-ctl border border-warning-border bg-warning-bg px-2.5 text-[12px] font-medium text-warning-text"
      data-test="workflow-state"
    >
      <span class="h-1.5 w-1.5 rounded-full bg-warning-accent" />
      {{ t('Test run · records, does not send', 'Prueba · registra, no envía') }}
    </span>
    <span
      v-else-if="activeWorkflow"
      class="flex h-8 items-center gap-1.5 rounded-ctl border px-2.5 text-[12px] font-medium"
      :class="activeWorkflow.enabled ? 'border-success-border bg-success-bg text-success-text' : 'border-chip-border bg-chip-bg text-ink-muted'"
      data-test="workflow-state"
    >
      <span class="h-1.5 w-1.5 rounded-full" :class="activeWorkflow.enabled ? 'bg-success-accent' : 'bg-toggle-off'" />
      {{ activeWorkflow.enabled ? t('Enabled', 'Activo') : t('Paused', 'En pausa') }}
    </span>
    <NuxtLink
      v-if="activeWorkflow"
      to="/campaigns"
      class="flex h-8 items-center rounded-ctl bg-brand px-3.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
    >
      {{ t('Edit', 'Editar') }}
    </NuxtLink>
  </PageHeader>

  <div class="flex-1 overflow-y-auto">
    <div class="p-4 sm:p-6">
      <div v-if="!allowed" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">{{ t("You don't have access to Growth.", 'No tienes acceso a Crecimiento.') }}</p>
      </div>

      <div v-else-if="resolved && !hasGrowth" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">{{ t('The automation builder is part of the Growth tier.', 'El creador de automatizaciones forma parte del plan Growth.') }}</p>
        <NuxtLink to="/growth" class="mt-3 inline-flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover">
          {{ t('See what Growth adds', 'Ver qué añade Growth') }}
        </NuxtLink>
      </div>

      <div v-else-if="!resolved || loading" class="grid animate-pulse gap-4 xl:grid-cols-[220px_minmax(0,1fr)_260px]" aria-hidden="true">
        <div class="h-[420px] rounded-card border border-line bg-surface shadow-card" />
        <div class="h-[660px] rounded-card border border-line bg-surface shadow-card" />
        <div class="h-[320px] rounded-card border border-line bg-surface shadow-card" />
      </div>

      <div v-else class="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_260px] xl:items-start">
        <!-- Workflow list -->
        <div class="flex flex-col gap-4">
          <section class="flex flex-col gap-1 rounded-card border border-line bg-surface p-3 shadow-card">
            <div class="flex items-baseline justify-between gap-2 px-0.5 pb-1">
              <h2 class="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Workflows', 'Flujos') }}</h2>
              <!-- Editing lives in Campaigns, which is where these rules are
              actually built. A second editor here would be a second source of
              truth for the same rows. -->
              <NuxtLink to="/campaigns" class="text-[11px] font-semibold text-brand-text hover:underline">{{ t('Edit in Campaigns', 'Editar en Campañas') }}</NuxtLink>
            </div>
            <p v-if="workflows.length === 0" class="px-0.5 py-1 text-[11px] leading-[1.5] text-ink-muted" data-test="no-workflows">
              {{ t('No automations yet. Create one in Campaigns and it appears here.', 'Aún no hay automatizaciones. Crea una en Campañas y aparecerá aquí.') }}
            </p>
            <button
              v-for="flow in workflows"
              :key="flow.id"
              type="button"
              class="flex flex-col gap-0.5 rounded-ctl px-2 py-1.5 text-left"
              :class="activeWorkflowId === flow.id ? 'bg-brand-tint' : 'hover:bg-surface-subtle'"
              :data-test="`workflow-${flow.id}`"
              @click="selectWorkflow(flow.id)"
            >
              <span class="text-[11.5px] font-medium" :class="activeWorkflowId === flow.id ? 'text-brand-text' : 'text-ink-700'">{{ flow.name }}</span>
              <span class="flex items-center gap-1.5">
                <span class="h-1.5 w-1.5 rounded-full" :class="flow.dryRun ? 'bg-warning-accent' : flow.enabled ? 'bg-success-accent' : 'bg-toggle-off'" />
                <span class="text-[10px] text-ink-faint">{{ flow.runs }}</span>
              </span>
            </button>
          </section>

        </div>

        <!-- Canvas -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <NuxtLink to="/campaigns" class="flex h-7 items-center rounded-ctl border border-line-control bg-surface px-2.5 text-[11.5px] font-medium text-ink-700 hover:bg-surface-subtle">
              + {{ t('Add step in Campaigns', 'Añadir paso en Campañas') }}
            </NuxtLink>
          </div>
          <GrowthWorkflowCanvas
            :nodes="nodes"
            :edge-paths="edgePaths"
            :selected-id="selectedNodeId"
            @select="selectNode"
          />
        </div>

        <!-- Selected step -->
        <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card" data-test="node-config">
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Selected step', 'Paso seleccionado') }}</span>
            <span class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">
              {{ selectedNode?.eyebrow ? `${selectedNode.eyebrow} · ` : '' }}{{ selectedNode?.title }}
            </span>
          </div>

          <template v-if="selectedConfig">
            <div v-for="field in selectedConfig.fields" :key="field.label" class="flex flex-col gap-1">
              <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ field.label }}</span>
              <span class="rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-700">{{ field.value }}</span>
            </div>

            <!-- Only when there are any. Nothing in the schema branches yet,
            so every step has exactly one exit, and an empty "Outputs"
            heading is a gap where the fixture used to promise branches. -->
            <div v-if="selectedConfig.outputs.length > 0" class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
              <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Outputs', 'Salidas') }}</span>
              <div v-for="out in selectedConfig.outputs" :key="out.label" class="flex items-center justify-between gap-2 rounded-ctl border border-line bg-surface-subtle px-2.5 py-1.5">
                <span class="min-w-0 truncate text-[11px] text-ink-700">{{ out.label }}</span>
                <span class="shrink-0 font-mono text-[11px] text-ink-muted">{{ out.count }}</span>
              </div>
            </div>
          </template>

          <!-- Only the condition has its fields written out so far. Saying so
          beats an empty panel that looks broken. -->
          <p v-else class="text-[11.5px] leading-[1.5] text-ink-muted">
            {{ t('Configuration for this step type is not built yet. Select the condition to see a configured step.', 'La configuración de este tipo de paso aún no está hecha. Selecciona la condición para ver un paso configurado.') }}
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
