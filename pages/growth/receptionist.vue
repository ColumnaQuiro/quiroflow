<script setup lang="ts">
const t = useT()
const { can } = usePermission()
const { hasGrowth, resolved } = useGrowthTier()
const { config, loading, liveChannelCount } = useGrowthReceptionist()

// Same key as the rest of Growth -- see pages/growth/index.vue.
const allowed = computed(() => can('communication_config'))

const CHANNEL_STATUS_CLASS = {
  connected: 'border-success-border bg-success-bg text-success-text',
  needs_attention: 'border-danger-border bg-danger-bg text-danger-text',
  not_set_up: 'border-chip-border bg-chip-bg text-ink-muted',
} as const
</script>

<template>
  <PageHeader
    :title="t('AI receptionist', 'Recepcionista IA')"
    :meta="t('Answers on WhatsApp, SMS and web chat, qualifies the enquiry and books into the clinic calendar', 'Responde por WhatsApp, SMS y chat web, cualifica la consulta y reserva en el calendario de la clínica')"
  >
    <span v-if="config" class="flex h-8 items-center gap-1.5 rounded-ctl border border-success-border bg-success-bg px-2.5 text-[12px] font-medium text-success-text">
      <span class="h-1.5 w-1.5 rounded-full bg-success-accent" />
      {{ t('Live on', 'Activa en') }} {{ liveChannelCount }} {{ t('channels', 'canales') }}
    </span>
    <button
      type="button"
      class="flex h-8 items-center rounded-ctl bg-brand px-3.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
    >{{ t('Save changes', 'Guardar cambios') }}</button>
  </PageHeader>

  <div class="flex-1 overflow-y-auto">
    <div class="p-4 sm:p-6">
      <div v-if="!allowed" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">{{ t("You don't have access to Growth.", 'No tienes acceso a Crecimiento.') }}</p>
      </div>

      <div v-else-if="resolved && !hasGrowth" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">{{ t('The AI receptionist is part of the Growth tier.', 'La recepcionista IA forma parte del plan Growth.') }}</p>
        <NuxtLink to="/growth" class="mt-3 inline-flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover">
          {{ t('See what Growth adds', 'Ver qué añade Growth') }}
        </NuxtLink>
      </div>

      <div v-else-if="!resolved || loading || !config" class="flex animate-pulse flex-col gap-4" aria-hidden="true">
        <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div v-for="i in 4" :key="i" class="h-[68px] rounded-card border border-line bg-surface shadow-card" />
        </div>
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div class="h-[520px] rounded-card border border-line bg-surface shadow-card" />
          <div class="h-[520px] rounded-card border border-line bg-surface shadow-card" />
        </div>
      </div>

      <div v-else class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div v-for="stat in config.stats" :key="stat.key" class="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-[14px] shadow-card">
            <span class="text-[11px] text-ink-muted">{{ stat.label }}</span>
            <span class="text-[20px] font-semibold leading-none tracking-tightTitle text-ink-900">
              {{ stat.value }}<span v-if="stat.note" class="ml-1 text-[12px] font-normal text-ink-muted">{{ stat.note }}</span>
            </span>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div class="flex flex-col gap-4">
            <GrowthSettingCard :title="t('Persona', 'Personalidad')">
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="flex flex-col gap-1">
                  <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Name it answers with', 'Nombre con el que responde') }}</span>
                  <span class="rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-700">{{ config.personaName }}</span>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Languages', 'Idiomas') }}</span>
                  <div class="flex flex-wrap gap-1.5 pt-1">
                    <span v-for="lang in config.languages" :key="lang" class="rounded-pill border border-brand-tintBorder bg-brand-tint px-2 py-0.5 text-[11px] text-brand-text">{{ lang }}</span>
                  </div>
                </div>
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Tone', 'Tono') }}</span>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="tone in config.tones"
                    :key="tone.label"
                    class="rounded-pill border px-2.5 py-0.5 text-[11.5px]"
                    :class="tone.selected ? 'border-brand-tintBorder bg-brand-tint font-medium text-brand-text' : 'border-chip-border bg-chip-bg text-ink-muted'"
                  >{{ tone.label }}</span>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Never says', 'Nunca dice') }}</span>
                <p class="rounded-ctl border border-line bg-surface-subtle px-2.5 py-2 text-[11.5px] leading-[1.5] text-ink-muted">{{ config.neverSays }}</p>
              </div>
            </GrowthSettingCard>

            <GrowthSettingCard :title="t('Clinic knowledge base', 'Base de conocimiento')" :action="t('Add card', 'Añadir tarjeta')">
              <div class="grid gap-3 sm:grid-cols-2">
                <div v-for="card in config.knowledge" :key="card.id" class="flex flex-col gap-1.5 rounded-ctl border border-line bg-surface-subtle p-3">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[11.5px] font-semibold text-ink-900">{{ card.title }}</span>
                    <button type="button" class="shrink-0 text-[10.5px] font-medium text-brand-text hover:underline">{{ t('Edit', 'Editar') }}</button>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <span v-for="line in card.lines" :key="line" class="text-[11px] text-ink-muted">{{ line }}</span>
                  </div>
                  <!-- "Synced from Billing" is the point, not decoration: the
                  clinic's prices and hours already live in this app, so the
                  receptionist reads them rather than making the owner keep a
                  second copy that quietly drifts. -->
                  <span class="text-[10px]" :class="card.synced ? 'text-success-text' : 'text-ink-faint'">{{ card.footnote }}</span>
                </div>
              </div>
            </GrowthSettingCard>

            <div class="grid gap-4 xl:grid-cols-2">
              <GrowthSettingCard :title="t('Qualification questions', 'Preguntas de cualificación')">
                <ol class="flex flex-col gap-1.5">
                  <li v-for="(q, i) in config.questions" :key="q" class="flex items-start gap-2 text-[11.5px] text-ink-700">
                    <span class="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-chip-bg text-[9.5px] font-semibold text-ink-muted">{{ i + 1 }}</span>
                    <span>{{ q }}</span>
                  </li>
                </ol>
                <button type="button" class="self-start text-[11.5px] font-medium text-brand-text hover:underline">+ {{ t('Add question', 'Añadir pregunta') }}</button>
              </GrowthSettingCard>

              <GrowthSettingCard :title="t('Booking rules', 'Reglas de reserva')">
                <div class="flex flex-col gap-1.5">
                  <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('May book these appointment types', 'Puede reservar estos tipos de cita') }}</span>
                  <div class="flex flex-wrap gap-1.5">
                    <span
                      v-for="type in config.appointmentTypes"
                      :key="type.name"
                      class="rounded-pill border px-2 py-0.5 text-[11px]"
                      :class="type.enabled ? 'border-success-border bg-success-bg text-success-text' : 'border-chip-border bg-chip-bg text-ink-faint'"
                    >{{ type.name }}<span v-if="!type.enabled"> · {{ t('off', 'no') }}</span></span>
                  </div>
                </div>
                <dl class="flex flex-col gap-1">
                  <div v-for="rule in config.bookingRules" :key="rule.label" class="flex items-baseline justify-between gap-2 border-t border-line-divider pt-1.5 first:border-0 first:pt-0">
                    <dt class="text-[11px] text-ink-faint">{{ rule.label }}</dt>
                    <dd class="text-right text-[11.5px] text-ink-700">{{ rule.value }}</dd>
                  </div>
                </dl>
              </GrowthSettingCard>
            </div>

            <div class="grid gap-4 xl:grid-cols-2">
              <GrowthSettingCard :title="t('Escalation rules', 'Reglas de escalado')">
                <ul class="flex flex-col gap-1.5">
                  <li v-for="rule in config.escalationRules" :key="rule" class="rounded-ctl border border-line bg-surface-subtle px-2.5 py-1.5 text-[11.5px] text-ink-700">{{ rule }}</li>
                </ul>
                <p class="text-[10.5px] text-ink-muted">{{ config.escalationNote }}</p>
              </GrowthSettingCard>

              <GrowthSettingCard :title="t('Coverage and channels', 'Cobertura y canales')">
                <div class="flex flex-col gap-2">
                  <div v-for="item in config.coverage" :key="item.key" class="flex items-center justify-between gap-3">
                    <span class="text-[11.5px] text-ink-700">{{ item.label }}</span>
                    <!-- Rendered as state, not as a switch: nothing behind it
                    saves yet, and a toggle that flips back on reload is worse
                    than one that does not invite the click. -->
                    <span
                      class="shrink-0 rounded-pill border px-2 py-0.5 text-[10.5px] font-medium"
                      :class="item.enabled ? 'border-success-border bg-success-bg text-success-text' : 'border-chip-border bg-chip-bg text-ink-muted'"
                    >{{ item.enabled ? t('On', 'Activo') : t('Off', 'Inactivo') }}</span>
                  </div>
                </div>
                <div class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
                  <div v-for="channel in config.channels" :key="channel.name" class="flex items-center justify-between gap-3">
                    <span class="min-w-0 truncate text-[11.5px] text-ink-700">{{ channel.name }}</span>
                    <span class="shrink-0 rounded-pill border px-2 py-0.5 text-[10.5px] font-medium" :class="CHANNEL_STATUS_CLASS[channel.status]">
                      {{ channel.statusLabel }}
                    </span>
                  </div>
                </div>
              </GrowthSettingCard>
            </div>
          </div>

          <GrowthReceptionistTestChat :turns="config.testChat" :why="config.testChatWhy" />
        </div>
      </div>
    </div>
  </div>
</template>
