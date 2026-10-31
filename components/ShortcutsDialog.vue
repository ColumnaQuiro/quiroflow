<script setup lang="ts">
// The list behind "?": every single-key shortcut (composables/useShortcuts),
// by where it works. Keep it in step with the handlers -- the keys are
// written once there and once here.
const emit = defineEmits<{ close: [] }>()
const t = useT()

const sections = computed(() => [
  {
    title: t('Anywhere', 'En cualquier pantalla'),
    rows: [
      { keys: ['?'], label: t('This list', 'Esta lista') },
      { keys: ['/'], alt: '⌘K', label: t('Search patients or jump to a page', 'Buscar pacientes o ir a una página') },
      { keys: ['g', 'd'], label: t('Go to Dashboard', 'Ir al Panel') },
      { keys: ['g', 'm'], label: t('Go to My Day', 'Ir a Mi día') },
      { keys: ['g', 'c'], label: t('Go to Calendar', 'Ir al Calendario') },
      { keys: ['g', 'p'], label: t('Go to Patients', 'Ir a Pacientes') },
      { keys: ['g', 'i'], label: t('Go to Inbox', 'Ir a la Bandeja de entrada') },
      { keys: ['g', 'b'], label: t('Go to Billing', 'Ir a Facturación') },
      { keys: ['g', 'r'], label: t('Go to Reports', 'Ir a Informes') },
    ],
  },
  {
    title: t('Calendar', 'Calendario'),
    rows: [
      { keys: ['c'], alt: 'n', label: t('New appointment', 'Nueva cita') },
      { keys: ['t'], label: t('Today', 'Hoy') },
      { keys: ['j'], label: t('Next day or week', 'Día o semana siguiente') },
      { keys: ['k'], label: t('Previous day or week', 'Día o semana anterior') },
      { keys: ['d'], label: t('Day view', 'Vista de día') },
      { keys: ['w'], label: t('Work week view', 'Vista de semana laboral') },
      { keys: ['m'], label: t('Month view', 'Vista de mes') },
    ],
  },
  {
    title: t('An open appointment', 'Una cita abierta'),
    rows: [
      { keys: ['a'], label: t('Next step: check in, into session, to checkout', 'Siguiente paso: llegada, a consulta, a cobro') },
      { keys: ['p'], label: t('Take payment', 'Cobrar') },
      { keys: ['Esc'], label: t('Close', 'Cerrar') },
    ],
  },
  {
    title: t('Inbox', 'Bandeja de entrada'),
    rows: [
      { keys: ['j'], label: t('Next conversation', 'Conversación siguiente') },
      { keys: ['k'], label: t('Previous conversation', 'Conversación anterior') },
      { keys: ['u'], label: t('Next unread', 'Siguiente sin leer') },
      { keys: ['r'], label: t('Reply', 'Responder') },
    ],
  },
])

const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))
const kbd = 'inline-flex h-6 min-w-6 items-center justify-center rounded border border-line-control bg-surface-subtle px-1.5 font-mono text-[12px] text-ink-700'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim/40 px-4 py-[8vh]" @click.self="emit('close')">
    <div ref="panel" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" tabindex="-1" class="w-full max-w-2xl rounded-card border border-line bg-surface shadow-popover outline-none" data-cy="shortcuts-dialog">
      <div class="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 id="shortcuts-title" class="text-[15px] font-semibold text-ink-900">{{ t('Keyboard shortcuts', 'Atajos de teclado') }}</h2>
        <button type="button" class="flex h-8 w-8 items-center justify-center rounded-ctlSm text-ink-muted hover:bg-surface-subtle touch:h-11 touch:w-11" :aria-label="t('Close', 'Cerrar')" @click="emit('close')">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
        </button>
      </div>
      <div class="grid gap-x-8 gap-y-5 px-5 py-4 sm:grid-cols-2">
        <section v-for="s in sections" :key="s.title">
          <h3 class="mb-1.5 text-[11px] font-[640] uppercase tracking-[.06em] text-ink-muted">{{ s.title }}</h3>
          <dl>
            <div v-for="r in s.rows" :key="r.label" class="flex items-center justify-between gap-3 py-1">
              <dt class="text-[13.5px] text-ink-700">{{ r.label }}</dt>
              <dd class="flex shrink-0 items-center gap-1 text-[12px] text-ink-muted">
                <template v-for="(k, i) in r.keys" :key="k">
                  <span v-if="i > 0" aria-hidden="true">{{ t('then', 'y') }}</span>
                  <kbd :class="kbd">{{ k }}</kbd>
                </template>
                <template v-if="r.alt">
                  <span>{{ t('or', 'o') }}</span>
                  <kbd :class="kbd">{{ r.alt }}</kbd>
                </template>
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <p class="border-t border-line px-5 py-3 text-[12.5px] text-ink-muted">{{ t('Shortcuts do nothing while you are typing in a field.', 'Los atajos no actúan mientras escribes en un campo.') }}</p>
    </div>
  </div>
</template>
