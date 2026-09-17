<script setup lang="ts">
const t = useT()
const { can } = usePermission()
const { hasGrowth, resolved } = useGrowthTier()
const { config, channels, testModelAvailable, loading, saving, error, save, liveChannelCount } = useGrowthReceptionist()

const allowed = computed(() => can('communication_config'))

// The three lists the prompt is actually built from. They were rendered and
// not editable, which left the knowledge base permanently empty -- and the
// card itself says an empty one makes the receptionist deflect rather than
// answer. The endpoint already accepted all three; only the way in was
// missing.
const newQuestion = ref('')
const newRuleText = ref('')
const newRuleAction = ref('')
const newCardTitle = ref('')
const newCardLines = ref('')

function addKnowledgeCard() {
  const title = newCardTitle.value.trim()
  if (!title) return
  const lines = newCardLines.value.split('\n').map((l) => l.trim()).filter(Boolean)
  save({
    knowledge: [
      ...(config.value?.knowledge ?? []),
      // A stable id so Vue's keys and any later edit refer to the same card
      // rather than to whatever is currently in that position.
      { id: crypto.randomUUID(), title: title.slice(0, 120), lines },
    ],
  })
  newCardTitle.value = ''
  newCardLines.value = ''
}

function removeKnowledgeCard(id: string) {
  save({ knowledge: (config.value?.knowledge ?? []).filter((c) => c.id !== id) })
}

function addQuestion() {
  const question = newQuestion.value.trim()
  if (!question) return
  save({ qualificationQuestions: [...(config.value?.qualificationQuestions ?? []), question.slice(0, 300)] })
  newQuestion.value = ''
}

function removeQuestion(index: number) {
  save({ qualificationQuestions: (config.value?.qualificationQuestions ?? []).filter((_, i) => i !== index) })
}

function addEscalationRule() {
  const rule = newRuleText.value.trim()
  const action = newRuleAction.value.trim()
  if (!rule || !action) return
  save({ escalationRules: [...(config.value?.escalationRules ?? []), { rule: rule.slice(0, 300), action: action.slice(0, 300) }] })
  newRuleText.value = ''
  newRuleAction.value = ''
}

function removeEscalationRule(index: number) {
  save({ escalationRules: (config.value?.escalationRules ?? []).filter((_, i) => i !== index) })
}

const TONES = [
  { value: 'warm_brief', label: t('Warm and brief', 'Cercano y breve') },
  { value: 'clinical', label: t('Clinical', 'Clínico') },
  { value: 'chatty', label: t('Chatty', 'Conversacional') },
  { value: 'formal', label: t('Formal (usted)', 'Formal (usted)') },
]

const CHANNEL_CLASS: Record<string, string> = {
  connected: 'border-success-border bg-success-bg text-success-text',
  not_set_up: 'border-warning-border bg-warning-bg text-warning-text',
  not_built: 'border-chip-border bg-chip-bg text-ink-faint',
}
</script>

<template>
  <PageHeader
    :title="t('AI receptionist', 'Recepcionista IA')"
    :meta="t('Answers enquiries, qualifies them, and offers appointment times', 'Responde consultas, las cualifica y ofrece horarios de cita')"
  >
    <span
      v-if="config"
      class="flex h-8 items-center gap-1.5 rounded-ctl border px-2.5 text-[12px] font-medium"
      :class="config.enabled ? 'border-success-border bg-success-bg text-success-text' : 'border-chip-border bg-chip-bg text-ink-muted'"
      data-test="receptionist-status"
    >
      <span class="h-1.5 w-1.5 rounded-full" :class="config.enabled ? 'bg-success-accent' : 'bg-toggle-off'" />
      {{ config.enabled ? `${t('On', 'Activa')} · ${liveChannelCount} ${t('channel', 'canal')}${liveChannelCount === 1 ? '' : 's'}` : t('Off', 'Desactivada') }}
    </span>
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

      <p v-else-if="error" class="py-16 text-center text-[13px] text-danger-text" data-test="receptionist-error">{{ error }}</p>

      <div v-else-if="loading || !config" class="grid animate-pulse gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" aria-hidden="true">
        <div class="h-[520px] rounded-card border border-line bg-surface shadow-card" />
        <div class="h-[420px] rounded-card border border-line bg-surface shadow-card" />
      </div>

      <div v-else class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div class="flex flex-col gap-4">
          <!-- The switch that decides whether the receptionist touches real
          conversations at all, first and on its own. It used to record the
          intent and gate nothing, which was honest while there was nothing to
          gate; it now decides whether /api/growth/leads/:id/draft-reply will
          write anything, and the Inbox hides the button when it is off. Still
          off until someone turns it on. -->
          <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex flex-col gap-1">
                <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Answering', 'Respuestas') }}</h2>
                <p class="max-w-[46ch] text-[11.5px] leading-[1.5] text-ink-muted">
                  {{ t(
                    'On, the receptionist reads real enquiries in the Inbox and drafts replies for you to approve. It never sends on its own — every message is one somebody read first.',
                    'Activada, la recepcionista lee las consultas reales en la Bandeja y redacta respuestas para que las apruebes. Nunca envía por su cuenta: cada mensaje lo ha leído antes una persona.',
                  ) }}
                </p>
              </div>
              <UiBtn
                :variant="config.enabled ? 'secondary' : 'primary'"
                size="sm"
                :disabled="saving"
                data-test="toggle-enabled"
                @click="save({ enabled: !config.enabled })"
              >
                {{ config.enabled ? t('Turn off', 'Desactivar') : t('Turn on', 'Activar') }}
              </UiBtn>
            </div>

            <div class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
              <span class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Channels', 'Canales') }}</span>
              <div v-for="channel in channels" :key="channel.name" :data-test="`channel-${channel.key}`" class="flex items-center justify-between gap-3">
                <span class="text-[11.5px] text-ink-700">{{ channel.name }}</span>
                <span class="shrink-0 rounded-pill border px-2 py-0.5 text-[10.5px] font-medium" :class="CHANNEL_CLASS[channel.status]">
                  {{ channel.statusLabel }}
                </span>
              </div>
            </div>
          </section>

          <GrowthSettingCard :title="t('Persona', 'Personalidad')">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex flex-col gap-1">
                <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Name it answers with', 'Nombre con el que responde') }}</span>
                <input
                  :value="config.personaName"
                  type="text"
                  class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none"
                  data-test="persona-name"
                  @change="save({ personaName: ($event.target as HTMLInputElement).value })"
                >
              </label>
              <div class="flex flex-col gap-1">
                <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Languages', 'Idiomas') }}</span>
                <div class="flex flex-wrap gap-1.5 pt-1">
                  <span v-for="lang in config.languages" :key="lang" class="rounded-pill border border-brand-tintBorder bg-brand-tint px-2 py-0.5 text-[11px] uppercase text-brand-text">{{ lang }}</span>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-1.5">
              <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Tone', 'Tono') }}</span>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="tone in TONES"
                  :key="tone.value"
                  type="button"
                  class="rounded-pill border px-2.5 py-0.5 text-[11.5px]"
                  :class="config.tone === tone.value ? 'border-brand-tintBorder bg-brand-tint font-medium text-brand-text' : 'border-chip-border bg-chip-bg text-ink-muted hover:text-ink-700'"
                  :disabled="saving"
                  :data-test="`tone-${tone.value}`"
                  @click="save({ tone: tone.value })"
                >{{ tone.label }}</button>
              </div>
            </div>

            <label class="flex flex-col gap-1">
              <span class="text-[10.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Never says', 'Nunca dice') }}</span>
              <textarea
                :value="config.neverSays"
                rows="3"
                class="resize-none rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[11.5px] leading-[1.5] text-ink-700 focus:border-brand focus:outline-none"
                data-test="never-says"
                @change="save({ neverSays: ($event.target as HTMLTextAreaElement).value })"
              />
            </label>
          </GrowthSettingCard>

          <div class="grid gap-4 xl:grid-cols-2">
            <GrowthSettingCard :title="t('Clinic knowledge base', 'Base de conocimiento')">
              <p v-if="!config.knowledge.length" class="text-[11.5px] leading-[1.5] text-ink-muted" data-test="knowledge-empty">
                {{ t(
                  'Nothing yet. Without it the receptionist says it will check with a colleague rather than guessing at prices or hours.',
                  'Nada todavía. Sin esto, la recepcionista dirá que lo consultará con un compañero en lugar de inventar precios u horarios.',
                ) }}
              </p>
              <div v-for="card in config.knowledge" :key="card.id" class="flex flex-col gap-1 rounded-ctl border border-line bg-surface-subtle p-3" data-test="knowledge-card">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-[11.5px] font-semibold text-ink-900">{{ card.title }}</span>
                  <button
                    type="button"
                    class="shrink-0 text-[10.5px] font-medium text-danger-text hover:underline"
                    :disabled="saving"
                    :data-test="`remove-card-${card.id}`"
                    @click="removeKnowledgeCard(card.id)"
                  >{{ t('Remove', 'Quitar') }}</button>
                </div>
                <span v-for="line in card.lines" :key="line" class="text-[11px] text-ink-muted">{{ line }}</span>
              </div>

              <div class="flex flex-col gap-1.5 border-t border-line-divider pt-2.5">
                <input
                  v-model="newCardTitle"
                  type="text"
                  :placeholder="t('What it is about — e.g. Prices, Opening hours, Parking', 'De qué trata — p. ej. Precios, Horarios, Parking')"
                  class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none"
                  data-test="card-title"
                />
                <textarea
                  v-model="newCardLines"
                  rows="3"
                  :placeholder="t('One fact per line. First visit 50€\nFollow-up 40€', 'Un dato por línea. Primera visita 50€\nRevisión 40€')"
                  class="resize-none rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[12px] leading-[1.5] text-ink-700 focus:border-brand focus:outline-none"
                  data-test="card-lines"
                />
                <UiBtn variant="secondary" size="sm" class="self-start" :disabled="saving || !newCardTitle.trim()" data-test="add-card" @click="addKnowledgeCard">
                  {{ t('Add card', 'Añadir tarjeta') }}
                </UiBtn>
                <!-- The model is told these are the clinic's own facts, so a
                wrong one is repeated confidently to a patient rather than
                hedged. Worth saying where it is typed. -->
                <p class="text-[10.5px] leading-[1.5] text-ink-muted">
                  {{ t(
                    'The receptionist treats these as fact and repeats them to patients. Anything not here, it says it will check.',
                    'La recepcionista trata esto como un hecho y se lo repite a los pacientes. Lo que no esté aquí, dirá que lo consultará.',
                  ) }}
                </p>
              </div>
            </GrowthSettingCard>

            <GrowthSettingCard :title="t('Qualification questions', 'Preguntas de cualificación')">
              <p v-if="!config.qualificationQuestions.length" class="text-[11.5px] leading-[1.5] text-ink-muted" data-test="questions-empty">
                {{ t(
                  'None yet. The receptionist will answer and offer times without finding out what is wrong first.',
                  'Ninguna todavía. La recepcionista responderá y ofrecerá horarios sin averiguar antes qué le pasa.',
                ) }}
              </p>
              <ol v-else class="flex flex-col gap-1.5">
                <li
                  v-for="(question, i) in config.qualificationQuestions"
                  :key="`${question}-${i}`"
                  class="flex items-start justify-between gap-2 text-[11.5px] text-ink-700"
                  data-test="qualification-question"
                >
                  <span class="flex min-w-0 items-start gap-2">
                    <span class="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-chip-bg text-[9.5px] font-semibold text-ink-muted">{{ i + 1 }}</span>
                    <span>{{ question }}</span>
                  </span>
                  <button type="button" class="shrink-0 text-[10.5px] font-medium text-danger-text hover:underline" :disabled="saving" @click="removeQuestion(i)">
                    {{ t('Remove', 'Quitar') }}
                  </button>
                </li>
              </ol>

              <div class="flex flex-col gap-1.5 border-t border-line-divider pt-2.5">
                <input
                  v-model="newQuestion"
                  type="text"
                  :placeholder="t('e.g. How long have you had it?', 'p. ej. ¿Desde cuándo lo tienes?')"
                  class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none"
                  data-test="question-text"
                  @keyup.enter="addQuestion"
                />
                <UiBtn variant="secondary" size="sm" class="self-start" :disabled="saving || !newQuestion.trim()" data-test="add-question" @click="addQuestion">
                  {{ t('Add question', 'Añadir pregunta') }}
                </UiBtn>
                <!-- Order is the order they get asked, because that is how the
                prompt lists them. -->
                <p class="text-[10.5px] leading-[1.5] text-ink-muted">
                  {{ t('Asked in this order, one at a time.', 'Se preguntan en este orden, de una en una.') }}
                </p>
              </div>
            </GrowthSettingCard>

            <GrowthSettingCard :title="t('Booking rules', 'Reglas de reserva')">
              <!-- Stated as what the AI may do, because the sentence the model
              is given is built from exactly these numbers. -->
              <dl class="flex flex-col gap-1">
                <div class="flex items-baseline justify-between gap-2">
                  <dt class="text-[11px] text-ink-faint">{{ t('Booking window', 'Ventana de reserva') }}</dt>
                  <dd class="text-[11.5px] text-ink-700">{{ config.bookingWindowDays }} {{ t('days', 'días') }}</dd>
                </div>
                <div class="flex items-baseline justify-between gap-2 border-t border-line-divider pt-1.5">
                  <dt class="text-[11px] text-ink-faint">{{ t('Minimum notice', 'Antelación mínima') }}</dt>
                  <dd class="text-[11.5px] text-ink-700">{{ config.minimumNoticeMinutes }} {{ t('minutes', 'minutos') }}</dd>
                </div>
                <div class="flex items-baseline justify-between gap-2 border-t border-line-divider pt-1.5">
                  <dt class="text-[11px] text-ink-faint">{{ t('Slots offered per reply', 'Horarios por respuesta') }}</dt>
                  <dd class="text-[11.5px] text-ink-700">{{ config.slotsPerReply }}</dd>
                </div>
                <div class="flex items-baseline justify-between gap-2 border-t border-line-divider pt-1.5">
                  <dt class="text-[11px] text-ink-faint">{{ t('May book', 'Puede reservar') }}</dt>
                  <dd class="text-right text-[11.5px] text-ink-700">
                    {{ config.bookableAppointmentTypeIds.length
                      ? `${config.bookableAppointmentTypeIds.length} ${t('appointment types', 'tipos de cita')}`
                      : t('Nothing yet', 'Nada todavía') }}
                  </dd>
                </div>
              </dl>
              <p class="text-[10.5px] leading-[1.5] text-ink-muted">
                {{ t(
                  'The receptionist offers times and never confirms a booking itself. A person or the booking system confirms.',
                  'La recepcionista ofrece horarios y nunca confirma una reserva. Confirma una persona o el sistema de reservas.',
                ) }}
              </p>
            </GrowthSettingCard>
          </div>

          <GrowthSettingCard :title="t('Escalation rules', 'Reglas de escalado')">
            <p v-if="!config.escalationRules.length" class="text-[11.5px] text-ink-muted" data-test="escalation-empty">
              {{ t('None set. The receptionist will answer everything it can.', 'Ninguna definida. La recepcionista responderá todo lo que pueda.') }}
            </p>
            <ul v-else class="flex flex-col gap-1.5">
              <li
                v-for="(rule, i) in config.escalationRules"
                :key="`${rule.rule}-${i}`"
                class="flex items-baseline justify-between gap-2 rounded-ctl border border-line bg-surface-subtle px-2.5 py-1.5 text-[11.5px] text-ink-700"
                data-test="escalation-rule"
              >
                <span class="min-w-0">{{ rule.rule }} → {{ rule.action }}</span>
                <button type="button" class="shrink-0 text-[10.5px] font-medium text-danger-text hover:underline" :disabled="saving" @click="removeEscalationRule(i)">
                  {{ t('Remove', 'Quitar') }}
                </button>
              </li>
            </ul>

            <div class="flex flex-col gap-1.5 border-t border-line-divider pt-2.5">
              <div class="grid gap-1.5 sm:grid-cols-2">
                <input
                  v-model="newRuleText"
                  type="text"
                  :placeholder="t('When… e.g. they mention chest pain', 'Cuando… p. ej. mencionan dolor torácico')"
                  class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none"
                  data-test="rule-when"
                />
                <input
                  v-model="newRuleAction"
                  type="text"
                  :placeholder="t('Then… e.g. hand to a chiropractor now', 'Entonces… p. ej. pasar a un quiropráctico ya')"
                  class="h-8 rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-700 focus:border-brand focus:outline-none"
                  data-test="rule-then"
                />
              </div>
              <UiBtn variant="secondary" size="sm" class="self-start" :disabled="saving || !newRuleText.trim() || !newRuleAction.trim()" data-test="add-rule" @click="addEscalationRule">
                {{ t('Add rule', 'Añadir regla') }}
              </UiBtn>
            </div>
          </GrowthSettingCard>
        </div>

        <GrowthReceptionistTestChat :available="testModelAvailable" :persona-name="config.personaName" />
      </div>
    </div>
  </div>
</template>
