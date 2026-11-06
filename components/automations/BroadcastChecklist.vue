<script setup lang="ts">
import { stepTitle, triggerDetail, filtersText } from '~/utils/automationDescribe'
import { asAudienceRef } from '~/utils/automationAudience'
import { chainOf } from '~/utils/automationTree'
import { HINT } from '~/utils/automationUi'

// A one-off send (a group checked once) as a checklist rather than a canvas:
// who, the message, when, and what counts as it working. Each "Change" opens
// the same drawer the canvas would, so there is one way to edit each part;
// "Show as a flow" is there for a send that grows follow-up steps.

const emit = defineEmits<{ flow: [] }>()
const b = useBuilder()
const t = useT()
const supabase = useSupabaseClient()

const rule = computed(() => b.draft.value.rule)
const segment = computed(() => rule.value.segment ?? null)

// ---- who
const audience = computed(() => asAudienceRef(segment.value?.audience))
const audienceName = ref<string | null>(null)
watch(
  audience,
  async (ref) => {
    audienceName.value = null
    if (!ref) return
    const { data } = await supabase.from(ref.kind === 'list' ? 'patient_lists' : 'patient_segments').select('name').eq('id', ref.id).maybeSingle()
    audienceName.value = (data as { name?: string } | null)?.name ?? t('a list that no longer exists', 'una lista que ya no existe')
  },
  { immediate: true },
)
const who = computed(() => {
  if (audience.value) {
    const kind = audience.value.kind === 'list' ? t('List', 'Lista') : t('Segment', 'Segmento')
    const excluded = (segment.value?.exclude ?? []).length
    return `${kind} «${audienceName.value ?? '…'}»${excluded ? t(`, leaving out ${excluded}`, `, excepto ${excluded}`) : ''}`
  }
  const f = filtersText(t, segment.value?.filters ?? {}, b.lookup.value)
  return f || null
})

// ---- the message: the first step of the root chain
const message = computed(() => chainOf(b.draft.value.steps, null, null).find((s) => s.action_type === 'email' || s.action_type === 'whatsapp_template') ?? null)
const followUps = computed(() => b.draft.value.steps.length - (message.value ? 1 : 0))
function addMessage(type: 'email' | 'whatsapp_template') {
  // At the start of the root chain; x and y are only where a "+" is drawn.
  const first = chainOf(b.draft.value.steps, null, null)[0]?.id ?? null
  b.addStep({ x: 0, y: 0, parentId: null, branch: null, index: 0, afterId: null, beforeId: first }, type)
  const added = chainOf(b.draft.value.steps, null, null)[0]
  if (added) b.selection.value = { kind: 'step', id: added.id }
}

// ---- when
const when = computed(() => triggerDetail(t, rule.value, b.lookup.value))

// ---- goal: bookings within two weeks of entering (automationStats.bookedAfter)
const totals = computed(() => b.stats.value.rule)
const bookedExit = computed(() => rule.value.exit_on.includes('appointment.booked'))
function toggleBookedExit(on: boolean) {
  const next = new Set(rule.value.exit_on)
  if (on) next.add('appointment.booked')
  else next.delete('appointment.booked')
  b.updateRule({ exit_on: [...next] })
}

const problems = computed(() => b.problems.value)
const done = {
  who: computed(() => !!audience.value || !!who.value),
  message: computed(() => !!message.value && !problems.value.some((p) => p.stepId === message.value!.id)),
}
const CARD = 'grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-card border border-line bg-surface px-4 py-3.5 shadow-card'
const TICK = 'mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold'
</script>

<template>
  <div class="h-full overflow-y-auto px-4 py-6 pb-32 sm:px-6" data-test="broadcast-checklist">
    <div class="mx-auto flex max-w-[640px] flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ t('One-off send', 'Envío puntual') }}</span>
        <button type="button" class="text-[12.5px] font-semibold text-brand-text hover:underline touch:min-h-11" data-test="broadcast-show-flow" @click="emit('flow')">{{ t('Show as a flow', 'Ver como flujo') }}</button>
      </div>

      <!-- Who -->
      <section :class="CARD" data-test="broadcast-who">
        <span :class="[TICK, done.who.value ? 'bg-success-bg text-success-text' : 'border border-line-control text-ink-faint']" aria-hidden="true">{{ done.who.value ? '✓' : '1' }}</span>
        <strong class="text-[14px] text-ink-900">{{ t('Who', 'A quién') }}</strong>
        <UiBtn size="sm" variant="ghost" data-test="broadcast-change-who" @click="b.selection.value = { kind: 'trigger' }">{{ done.who.value ? t('Change', 'Cambiar') : t('Choose', 'Elegir') }}</UiBtn>
        <span class="col-start-2 col-end-4 text-[12.5px] text-ink-muted">{{ who ?? t('Nobody chosen yet: a list, a segment, or filters.', 'Aún nadie: una lista, un segmento o unos filtros.') }}</span>
        <span v-if="rule.is_marketing" class="col-start-2 col-end-4 text-[12px] text-ink-muted">{{ t('Marketing: only patients who accepted it receive it.', 'Comercial: solo lo reciben los pacientes que lo aceptaron.') }}</span>
      </section>

      <!-- The message -->
      <section :class="CARD" data-test="broadcast-message">
        <span :class="[TICK, done.message.value ? 'bg-success-bg text-success-text' : 'border border-line-control text-ink-faint']" aria-hidden="true">{{ done.message.value ? '✓' : '2' }}</span>
        <strong class="text-[14px] text-ink-900">{{ t('Message', 'Mensaje') }}</strong>
        <UiBtn v-if="message" size="sm" variant="ghost" data-test="broadcast-edit-message" @click="b.selection.value = { kind: 'step', id: message.id }">{{ t('Edit', 'Editar') }}</UiBtn>
        <span v-else />
        <span v-if="message" class="col-start-2 col-end-4 truncate text-[12.5px] text-ink-muted">{{ stepTitle(t, message, b.lookup.value) }}<template v-if="followUps > 0"> · {{ t(`and ${followUps} more step${followUps === 1 ? '' : 's'}`, `y ${followUps} paso${followUps === 1 ? '' : 's'} más`) }}</template></span>
        <span v-else class="col-start-2 col-end-4 flex flex-wrap gap-2">
          <UiBtn size="sm" data-test="broadcast-add-email" @click="addMessage('email')">{{ t('Write an email', 'Escribir un email') }}</UiBtn>
          <UiBtn size="sm" data-test="broadcast-add-whatsapp" @click="addMessage('whatsapp_template')">{{ t('A WhatsApp template', 'Una plantilla de WhatsApp') }}</UiBtn>
        </span>
      </section>

      <!-- When -->
      <section :class="CARD" data-test="broadcast-when">
        <span :class="[TICK, 'bg-success-bg text-success-text']" aria-hidden="true">✓</span>
        <strong class="text-[14px] text-ink-900">{{ t('When', 'Cuándo') }}</strong>
        <UiBtn size="sm" variant="ghost" @click="b.selection.value = { kind: 'trigger' }">{{ t('Change', 'Cambiar') }}</UiBtn>
        <span class="col-start-2 col-end-4 text-[12.5px] text-ink-muted">{{ segment?.schedule?.starts_at ? when : t('As soon as it is switched on, within the sending hours in Settings.', 'En cuanto se active, dentro del horario de envío de Ajustes.') }}</span>
      </section>

      <!-- Goal -->
      <section :class="CARD" data-test="broadcast-goal">
        <span :class="[TICK, 'bg-success-bg text-success-text']" aria-hidden="true">✓</span>
        <strong class="text-[14px] text-ink-900">{{ t('Goal', 'Objetivo') }}</strong>
        <span />
        <span class="col-start-2 col-end-4 text-[12.5px] text-ink-muted">{{ t('Counted as working for whoever books an appointment within 14 days of receiving it.', 'Cuenta como logrado para quien reserve una cita en los 14 días siguientes a recibirlo.') }}</span>
        <span v-if="totals && totals.entered > 0" class="col-start-2 col-end-4 text-[12.5px] text-ink-700" data-test="broadcast-goal-figure">
          <strong class="font-mono text-ink-900">{{ totals.booked }}</strong> {{ t(`of ${totals.entered} booked`, `de ${totals.entered} reservaron`) }}
        </span>
        <label v-if="followUps > 0" class="col-start-2 col-end-4 mt-1 flex items-start gap-2 text-[12.5px] text-ink-700 touch:min-h-11">
          <input type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" :checked="bookedExit" data-test="broadcast-goal-exit" @change="toggleBookedExit(($event.target as HTMLInputElement).checked)" />
          {{ t('Stop the follow-ups for whoever books', 'Parar los siguientes pasos para quien reserve') }}
        </label>
      </section>

      <p :class="HINT">{{ t('When everything is ready, switch it on at the top. "Send test" sends it to you first.', 'Cuando esté todo listo, actívalo arriba. «Enviar prueba» te lo manda antes a ti.') }}</p>
    </div>
  </div>
</template>
