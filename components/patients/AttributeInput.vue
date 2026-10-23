<script setup lang="ts">
import type { PatientAttribute } from '~/utils/patientAttributes'

// One custom patient field as a form control, by its kind. The value is the
// form's own (a number may still have a comma in it); the caller stores it
// through normalizePatientAttributeValue. Yes/no is a select rather than a
// checkbox: "not asked yet" and "no" are different answers to
// "Consentimiento fotos".
const props = defineProps<{ attribute: PatientAttribute; required?: boolean; inputId?: string }>()
const model = defineModel<string | null>({ default: null })
const t = useT()

const text = computed({
  get: () => model.value ?? '',
  set: (v: string) => (model.value = v === '' ? null : v),
})

const inputClass =
  'mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none'
</script>

<template>
  <textarea
    v-if="props.attribute.kind === 'long_text'"
    :id="inputId"
    v-model="text"
    rows="3"
    maxlength="10000"
    :required="required"
    :class="inputClass"
    data-cy="custom-field-input"
    :data-key="attribute.key"
  />
  <input
    v-else-if="attribute.kind === 'number'"
    :id="inputId"
    v-model="text"
    type="text"
    inputmode="decimal"
    pattern="-?[0-9]+([.,][0-9]+)?"
    :title="t('A number, such as 42 or 3,5', 'Un número, como 42 o 3,5')"
    :required="required"
    :class="inputClass"
    data-cy="custom-field-input"
    :data-key="attribute.key"
  />
  <input
    v-else-if="attribute.kind === 'date'"
    :id="inputId"
    v-model="text"
    type="date"
    :required="required"
    :class="inputClass"
    data-cy="custom-field-input"
    :data-key="attribute.key"
  />
  <select
    v-else-if="attribute.kind === 'boolean'"
    :id="inputId"
    v-model="text"
    :required="required"
    :class="inputClass"
    data-cy="custom-field-input"
    :data-key="attribute.key"
  >
    <option value="">{{ t('Not set', 'Sin indicar') }}</option>
    <option value="true">{{ t('Yes', 'Sí') }}</option>
    <option value="false">{{ t('No', 'No') }}</option>
  </select>
  <select
    v-else-if="attribute.kind === 'choice'"
    :id="inputId"
    v-model="text"
    :required="required"
    :class="inputClass"
    data-cy="custom-field-input"
    :data-key="attribute.key"
  >
    <option value="">{{ t('Not set', 'Sin indicar') }}</option>
    <option v-for="o in attribute.options" :key="o" :value="o">{{ o }}</option>
    <!-- An answer whose option has since been reworded or removed stays
         selectable, rather than the select silently showing it as blank. -->
    <option v-if="text && !attribute.options.includes(text)" :value="text">{{ text }}</option>
  </select>
  <input
    v-else
    :id="inputId"
    v-model="text"
    type="text"
    maxlength="500"
    :required="required"
    :class="inputClass"
    data-cy="custom-field-input"
    :data-key="attribute.key"
  />
</template>
