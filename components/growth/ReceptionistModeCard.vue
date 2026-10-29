<script setup lang="ts">
import type { ReceptionistChannel, ReceptionistConfig } from '~/composables/useGrowthReceptionist'

// Whether the receptionist touches real conversations, and how far it goes
// when it does -- one choice, read back as one sentence.
//
// It used to be a Turn on/off button and two checkboxes under it, which
// stored the same three columns but left the owner to work out what the
// combination meant. The three columns stay (enabled, after_hours,
// answer_during_hours); only the way in changes:
//
//   off     enabled = false
//   draft   enabled = true, neither hours switch on: it writes a draft for
//           a person to approve, and nothing else
//   auto    enabled = true and at least one hours switch on: it sends on its
//           own in those hours, and drafts in the others
//
// Still off until somebody turns it on. A receptionist that began answering
// patients because someone opened the settings screen would be the worst
// failure this feature could have.
const props = defineProps<{
  config: ReceptionistConfig
  channels: ReceptionistChannel[]
  saving: boolean
  save: (patch: Partial<ReceptionistConfig>) => Promise<boolean>
}>()

const t = useT()

type Mode = 'off' | 'draft' | 'auto'
const mode = computed<Mode>(() => (!props.config.enabled ? 'off' : props.config.afterHours || props.config.answerDuringHours ? 'auto' : 'draft'))

function choose(next: Mode) {
  if (next === mode.value || props.saving) return
  if (next === 'off') return void props.save({ enabled: false })
  if (next === 'draft') return void props.save({ enabled: true, afterHours: false, answerDuringHours: false })
  // Outside clinic hours first: in hours the front desk is there, so that is
  // the switch a clinic turns on second, deliberately.
  void props.save({ enabled: true, afterHours: true })
}

const MODES: { key: Mode; label: string; detail: string; test: string }[] = [
  { key: 'off', label: t('Off', 'Desactivada'), detail: t('It reads nothing and writes nothing.', 'No lee ni escribe nada.'), test: 'mode-off' },
  {
    key: 'draft',
    label: t('Drafts for you to approve', 'Redacta y tú apruebas'),
    detail: t('It writes a reply to every enquiry and patient message; a person reads it in the Inbox and sends it, edits it, or discards it. Nothing goes out on its own.', 'Escribe una respuesta a cada consulta y mensaje de paciente; una persona la lee en la Bandeja y la envía, la edita o la descarta. Nada sale solo.'),
    test: 'mode-draft',
  },
  {
    key: 'auto',
    label: t('Answers on its own', 'Contesta sola'),
    detail: t('It sends its replies itself in the hours you choose below, and books or moves visits when a patient accepts a time. In the other hours it drafts.', 'Envía sus respuestas ella misma en las horas que elijas abajo, y reserva o mueve citas cuando el paciente acepta una hora. En las demás horas, redacta.'),
    test: 'mode-auto',
  },
]

const CHANNEL_CLASS: Record<string, string> = {
  connected: 'border-success-border bg-success-bg text-success-text',
  not_set_up: 'border-warning-border bg-warning-bg text-warning-text',
  not_built: 'border-chip-border bg-chip-bg text-ink-faint',
}
// Where a channel is set up. Instagram is connected from the WhatsApp page
// too (the same Meta app); the two that are not built have nowhere to go.
const CHANNEL_LINK: Record<string, string> = { whatsapp: '/settings/whatsapp', instagram: '/settings/whatsapp', messenger: '/settings/whatsapp', 'web-chat': '/settings/whatsapp' }

const noLiveChannel = computed(() => props.config.enabled && !props.channels.some((c) => c.status === 'connected'))
</script>

<template>
  <GrowthSettingCard :title="t('Answering', 'Respuestas')">
    <div role="radiogroup" :aria-label="t('How it answers', 'Cómo responde')" class="flex flex-col gap-1.5" data-test="answering-mode">
      <label
        v-for="m in MODES"
        :key="m.key"
        class="flex cursor-pointer items-start gap-2.5 rounded-ctl border px-3 py-2.5"
        :class="mode === m.key ? 'border-brand-tintBorder bg-brand-tint' : 'border-line-control bg-surface hover:bg-surface-subtle'"
        :data-test="m.test"
      >
        <input type="radio" name="answering-mode" :value="m.key" :checked="mode === m.key" :disabled="saving" class="mt-0.5 accent-brand" @change="choose(m.key)">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="text-[12.5px] font-semibold" :class="mode === m.key ? 'text-brand-text' : 'text-ink-900'">{{ m.label }}</span>
          <span class="text-[11.5px] leading-[1.5] text-ink-muted">{{ m.detail }}</span>
        </span>
      </label>
    </div>

    <!-- When it sends on its own (utils/receptionistAutoReply.ts). Shown
    for the choice above so the hours are read as part of it; the switches
    themselves are the two columns the tick reads. -->
    <div v-if="mode === 'auto'" class="flex flex-col gap-2 border-t border-line-divider pt-3" data-test="auto-reply">
      <span class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('When it sends on its own', 'Cuándo envía sola') }}</span>
      <label class="flex items-start gap-2 text-[11.5px] text-ink-700">
        <input
          type="checkbox"
          class="mt-0.5 h-3.5 w-3.5 accent-brand"
          :checked="config.afterHours"
          :disabled="saving"
          data-test="toggle-after-hours"
          @change="save({ afterHours: ($event.target as HTMLInputElement).checked })"
        >
        <span>{{ t('Outside clinic hours (nights, weekends)', 'Fuera del horario de la clínica (noches, fines de semana)') }}</span>
      </label>
      <label class="flex items-start gap-2 text-[11.5px] text-ink-700">
        <input
          type="checkbox"
          class="mt-0.5 h-3.5 w-3.5 accent-brand"
          :checked="config.answerDuringHours"
          :disabled="saving"
          data-test="toggle-during-hours"
          @change="save({ answerDuringHours: ($event.target as HTMLInputElement).checked })"
        >
        <span>{{ t('During clinic hours too', 'También en horario de clínica') }}</span>
      </label>
      <p class="max-w-[52ch] text-[11px] leading-[1.5] text-ink-muted">
        {{ t(
          'Even then it stays quiet in a conversation someone from the clinic replied to in the last hour, sends at most 8 messages a day in one conversation, and hands anything an escalation rule covers to a person with a note in the conversation.',
          'Aun así, se calla en una conversación en la que alguien de la clínica ha escrito en la última hora, envía como mucho 8 mensajes al día por conversación y pasa a una persona lo que cubre una regla de escalado, con una nota en la conversación.',
        ) }}
      </p>
    </div>

    <div class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
      <span class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Channels', 'Canales') }}</span>
      <div v-for="channel in channels" :key="channel.key" :data-test="`channel-${channel.key}`" class="flex items-center justify-between gap-3">
        <span class="text-[11.5px] text-ink-700">{{ channel.name }}</span>
        <span class="flex shrink-0 items-center gap-2">
          <NuxtLink
            v-if="channel.status === 'not_set_up' && CHANNEL_LINK[channel.key]"
            :to="CHANNEL_LINK[channel.key]!"
            class="text-[11px] font-medium text-brand-text hover:underline"
            :data-test="`channel-${channel.key}-setup`"
          >{{ t('Set up', 'Configurar') }} →</NuxtLink>
          <span class="rounded-pill border px-2 py-0.5 text-[10.5px] font-medium" :class="CHANNEL_CLASS[channel.status]">
            {{ channel.statusLabel }}
          </span>
        </span>
      </div>
      <!-- "On" with nothing connected is on paper only: said here, beside
      the channels, rather than left for the owner to infer. -->
      <p v-if="noLiveChannel" class="mt-1 rounded-ctl border border-warning-border bg-warning-bg px-2.5 py-1.5 text-[11.5px] leading-[1.5] text-warning-text" data-test="no-channel-warning">
        {{ t('No channel is connected, so no message reaches it yet. Connect WhatsApp or Instagram and it starts with the next one.', 'No hay ningún canal conectado, así que todavía no le llega ningún mensaje. Conecta WhatsApp o Instagram y empezará con el siguiente.') }}
      </p>
    </div>
  </GrowthSettingCard>
</template>
