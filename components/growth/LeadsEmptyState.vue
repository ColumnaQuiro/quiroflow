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
      <!-- The same 48px tile as UiEmptyState. It held a "+" typed at 20px
      light, which drew thin and off-centre, and grew to 44px on a touch
      screen as if it were a button. -->
      <div class="flex h-12 w-12 items-center justify-center rounded-card border border-brand-tintBorder bg-brand-tint text-brand-text" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </div>

      <div class="flex flex-col items-center gap-2">
        <h2 class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('No leads yet', 'Aún no hay contactos') }}</h2>
        <p class="max-w-[46ch] text-[12.5px] leading-[1.55] text-ink-muted">
          {{ t(
            'Connect a channel and the first enquiry lands here. Leads booked by the AI receptionist appear straight in your clinic calendar, and converting one opens a real patient record.',
            'Conecta un canal y la primera consulta aparecerá aquí. Los contactos que reserve la recepcionista IA entran directamente en el calendario de tu clínica, y al convertir uno se abre una ficha de paciente real.',
          ) }}
        </p>
      </div>

      <div class="flex flex-wrap justify-center gap-2">
        <NuxtLink
          to="/settings/whatsapp"
          class="flex h-9 touch:h-11 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-brand-on hover:bg-brand-hover"
        >{{ t('Connect WhatsApp', 'Conectar WhatsApp') }}</NuxtLink>
        <button
          type="button"
          class="flex h-9 touch:h-11 items-center rounded-ctl border border-line-control bg-surface px-4 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle"
        >{{ t('Add lead manually', 'Añadir contacto manualmente') }}</button>
      </div>

      <div class="flex w-full flex-col gap-2.5 rounded-card border border-line bg-surface p-4 text-left shadow-card">
        <span class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">
          {{ t('Set-up', 'Configuración') }} · {{ doneCount }} {{ t('of', 'de') }} {{ steps.length }} {{ t('done', 'completado') }}
        </span>
        <ul class="flex flex-col gap-1.5">
          <li v-for="step in steps" :key="step.label" class="flex items-center gap-2 text-[12px]">
            <GrowthCheckDot :done="step.done" />
            <span :class="step.done ? 'text-ink-muted line-through' : 'text-ink-700'">{{ step.label }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
