<script setup lang="ts">
import {
  BALANCE_OPTIONS,
  BRANCH_FIELDS,
  LEAD_CHANNEL_OPTIONS,
  LEAD_STAGE_OPTIONS,
  CONSENT_CHANNEL_OPTIONS,
  VALUELESS_OPS,
  conditionFieldDef,
  say,
  type ConditionFieldDef,
} from '~/utils/automationCatalog'
import { FIELD, FIELD_NUMBER, HINT, LABEL, LINK_BTN, NOTE, REMOVE_BTN, SEGMENT_WRAP, SECTION, segmentBtn } from '~/utils/automationUi'

// If / else: each person goes down "Yes" if they meet all (or any) of the
// conditions, "No" otherwise -- asked at the moment they reach the step, not
// when they entered. The questions are the engine's own fact list
// (utils/automationConditions.ts).

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)

type Cond = { field: string; op: string; value?: unknown }
const conditions = computed<Cond[]>(() => (Array.isArray(config.value.conditions) ? config.value.conditions : []))
const fields = computed(() =>
  BRANCH_FIELDS.filter((f) => (f.subject === 'lead' ? b.isLead.value : f.subject === 'patient' ? !b.isLead.value : true)).filter(
    (f) => !f.appointment || !['patient.birthday', 'patient.referred', 'segment', 'membership.new_member', 'membership.removed', 'membership.payment_processed', 'waitlist.slot_offered'].includes(b.draft.value.rule.trigger_event),
  ),
)

function defaultFor(def: ConditionFieldDef): Cond {
  const op = def.ops[0]!.op
  if (def.value === 'balance') return { field: def.field, op: 'lt', value: 0 }
  if (def.value === 'multi') return { field: def.field, op, value: [] }
  if (def.value === 'channel') return { field: def.field, op, value: 'whatsapp' }
  if (def.value === 'number') return { field: def.field, op, value: 1 }
  if (def.value === 'text') return { field: def.field, op, value: '' }
  return { field: def.field, op }
}
function update(i: number, next: Cond) {
  const list = [...conditions.value]
  list[i] = next
  set({ conditions: list })
}
function setField(i: number, field: string) {
  const def = conditionFieldDef(field)
  if (def) update(i, defaultFor(def))
}
function setOp(i: number, op: string) {
  const c = { ...conditions.value[i]!, op }
  if (VALUELESS_OPS.includes(op)) delete c.value
  update(i, c)
}
function add() {
  const def = fields.value[0]
  if (def) set({ conditions: [...conditions.value, defaultFor(def)] })
}
function remove(i: number) {
  set({ conditions: conditions.value.filter((_, j) => j !== i) })
}

function multiOptions(def: ConditionFieldDef) {
  if (def.options === 'appointment_types') return b.lookup.value.appointmentTypes.map((x) => ({ value: x.id, label: x.name }))
  if (def.options === 'practitioners') return b.lookup.value.practitioners.map((x) => ({ value: x.id, label: x.full_name }))
  if (def.options === 'lead_stages') return LEAD_STAGE_OPTIONS.map((x) => ({ value: x.value, label: say(t, x.label) }))
  if (def.options === 'lead_channels') return LEAD_CHANNEL_OPTIONS.map((x) => ({ value: x.value, label: say(t, x.label) }))
  return []
}
function balanceValue(c: Cond) {
  return BALANCE_OPTIONS.find((o) => o.op === c.op && Number(c.value) === o.cents)?.value ?? 'owes'
}
function setBalance(i: number, value: string) {
  const o = BALANCE_OPTIONS.find((x) => x.value === value)!
  update(i, { field: 'balance_cents', op: o.op, value: o.cents })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <label :class="LABEL">
      {{ t('Question (shown on the canvas)', 'Pregunta (se ve en el lienzo)') }}
      <input :class="FIELD" :value="config.title ?? ''" :placeholder="t('Has a future appointment?', '¿Tiene una cita futura?')" data-test="branch-title" @input="set({ title: ($event.target as HTMLInputElement).value })" />
    </label>

    <p class="text-[13px] leading-snug text-ink-700">
      {{ t('Each person goes down', 'Cada persona sigue por') }} <strong>{{ t('Yes', 'Sí') }}</strong>
      {{ config.match === 'any' ? t('if they meet any of the conditions', 'si cumple alguna de las condiciones') : t('if they meet all the conditions', 'si cumple todas las condiciones') }},
      {{ t('and down', 'y por') }} <strong>No</strong> {{ t('if not.', 'si no.') }}
    </p>
    <div :class="SEGMENT_WRAP" role="group">
      <button type="button" :class="segmentBtn(config.match !== 'any')" :aria-pressed="config.match !== 'any'" data-test="branch-all" @click="set({ match: 'all' })">{{ t('All', 'Todas') }}</button>
      <button type="button" :class="segmentBtn(config.match === 'any')" :aria-pressed="config.match === 'any'" data-test="branch-any" @click="set({ match: 'any' })">{{ t('Any', 'Alguna') }}</button>
    </div>

    <div v-for="(c, i) in conditions" :key="i" class="flex items-start gap-2" :data-test="`condition-${i}`">
      <div class="flex min-w-0 flex-1 flex-col gap-1.5 rounded-ctl border border-line bg-surface-subtle p-2.5">
        <select :class="FIELD" :value="c.field" :aria-label="t('Question', 'Pregunta')" data-test="condition-field" @change="setField(i, ($event.target as HTMLSelectElement).value)">
          <option v-for="f in fields" :key="f.field" :value="f.field">{{ say(t, f.label) }}</option>
        </select>
        <template v-if="conditionFieldDef(c.field)">
          <select v-if="conditionFieldDef(c.field)!.value === 'balance'" :class="FIELD" :value="balanceValue(c)" @change="setBalance(i, ($event.target as HTMLSelectElement).value)">
            <option v-for="o in BALANCE_OPTIONS" :key="o.value" :value="o.value">{{ say(t, o.label) }}</option>
          </select>
          <div v-else class="flex flex-wrap gap-1.5">
            <select :class="[FIELD, 'w-auto flex-none']" :value="c.op" :aria-label="t('Comparison', 'Comparación')" data-test="condition-op" @change="setOp(i, ($event.target as HTMLSelectElement).value)">
              <option v-for="o in conditionFieldDef(c.field)!.ops" :key="o.op" :value="o.op">{{ say(t, o.label) }}</option>
            </select>
            <template v-if="!VALUELESS_OPS.includes(c.op)">
              <AutomationsMultiPick
                v-if="conditionFieldDef(c.field)!.value === 'multi'"
                class="flex-1"
                :model-value="Array.isArray(c.value) ? (c.value as string[]) : []"
                :options="multiOptions(conditionFieldDef(c.field)!)"
                :placeholder="t('Choose…', 'Elige…')"
                @update:model-value="update(i, { ...c, value: $event })"
              />
              <select v-else-if="conditionFieldDef(c.field)!.value === 'channel'" :class="[FIELD, 'flex-1']" :value="c.value as string" @change="update(i, { ...c, value: ($event.target as HTMLSelectElement).value })">
                <option v-for="o in CONSENT_CHANNEL_OPTIONS" :key="o.value" :value="o.value">{{ say(t, o.label) }}</option>
              </select>
              <input
                v-else-if="conditionFieldDef(c.field)!.value === 'number'"
                type="number"
                min="0"
                :class="FIELD_NUMBER"
                :value="c.value as number"
                @input="update(i, { ...c, value: Number(($event.target as HTMLInputElement).value) })"
              />
              <input v-else :class="[FIELD, 'flex-1']" :value="(c.value as string) ?? ''" data-test="condition-value" @input="update(i, { ...c, value: ($event.target as HTMLInputElement).value })" />
            </template>
          </div>
        </template>
      </div>
      <button type="button" :class="REMOVE_BTN" :aria-label="t('Remove condition', 'Quitar condición')" @click="remove(i)">✕</button>
    </div>
    <button type="button" :class="LINK_BTN" data-test="condition-add" @click="add">+ {{ t('Add condition', 'Añadir condición') }}</button>

    <div class="flex flex-col gap-1">
      <span :class="SECTION">{{ t('You can ask about', 'Puedes preguntar por') }}</span>
      <p :class="HINT">
        {{ b.isLead.value
          ? t('Lead stage, source and channel, whether they replied or opened the last email, whether they have a phone or email.', 'Etapa, origen y canal del lead, si respondió o abrió el último email, si tiene teléfono o email.')
          : t('Future appointment, number of visits, tags, balance, active membership, the appointment type and practitioner, marketing consent, whether they replied or opened or clicked the email.', 'Cita futura, nº de visitas, etiquetas, saldo, membresía activa, tipo de cita y profesional, consentimiento de marketing, si respondió, abrió o hizo clic en el email.') }}
      </p>
    </div>
    <p :class="NOTE">{{ t('Checked when the person reaches this step, not when they entered.', 'Se comprueba en el momento en que la persona llega a este paso, no cuando entró.') }}</p>
  </div>
</template>
