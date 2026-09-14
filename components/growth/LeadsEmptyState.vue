<script setup lang="ts">
const t = useT()

// A brand-new clinic has no leads and no way to get one yet, so the empty
// state is a set-up checklist rather than a shrug. The first item is already
// done for every account -- public booking ships with the base plan -- which
// is what makes this read as progress rather than a wall of work.
const steps = [
  { done: true, label: t('Public booking page live', 'Página de reservas publicada') },
  { done: false, label: t('Connect WhatsApp Business number', 'Conectar número de WhatsApp Business') },
  { done: false, label: t('Turn on the AI receptionist', 'Activar la recepcionista IA') },
  { done: false, label: t('Import your Meta Ads lead form', 'Importar tu formulario de Meta Ads') },
]
const doneCount = steps.filter((s) => s.done).length
</script>

<template>
  <div class="flex justify-center px-4 py-12">
    <div class="flex w-full max-w-[520px] flex-col items-center gap-5 text-center">
      <div class="flex h-11 w-11 items-center justify-center rounded-card border border-brand-tintBorder bg-brand-tint text-[20px] font-light text-brand-text">
        +
      </div>

      <div class="flex flex-col gap-2">
        <h2 class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('No leads yet', 'Aún no hay contactos') }}</h2>
        <p class="text-[12.5px] leading-[1.55] text-ink-muted">
          {{ t(
            'Connect a channel and the first enquiry lands here. Leads booked by the AI receptionist appear straight in your clinic calendar, and converting one opens a real patient record.',
            'Conecta un canal y la primera consulta aparecerá aquí. Los contactos que reserve la recepcionista IA entran directamente en el calendario de tu clínica, y al convertir uno se abre una ficha de paciente real.',
          ) }}
        </p>
      </div>

      <div class="flex flex-wrap justify-center gap-2">
        <NuxtLink
          to="/settings/whatsapp"
          class="flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
        >{{ t('Connect WhatsApp', 'Conectar WhatsApp') }}</NuxtLink>
        <button
          type="button"
          class="flex h-9 items-center rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle"
        >{{ t('Add lead manually', 'Añadir contacto manualmente') }}</button>
      </div>

      <div class="flex w-full flex-col gap-2.5 rounded-card border border-line bg-surface p-4 text-left shadow-card">
        <span class="text-[10.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">
          {{ t('Set-up', 'Configuración') }} · {{ doneCount }} {{ t('of', 'de') }} {{ steps.length }} {{ t('done', 'completado') }}
        </span>
        <ul class="flex flex-col gap-1.5">
          <li v-for="step in steps" :key="step.label" class="flex items-center gap-2 text-[12px]">
            <span
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px]"
              :class="step.done ? 'bg-success-bg text-success-text' : 'border border-line-control text-ink-faint'"
            >{{ step.done ? '✓' : '' }}</span>
            <span :class="step.done ? 'text-ink-muted line-through' : 'text-ink-700'">{{ step.label }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
