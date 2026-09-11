<script setup lang="ts">
import type { DocField, DocFieldType } from '~/utils/docFields'

const props = defineProps<{ fields: DocField[]; mode: 'build' | 'fill' }>()
const emit = defineEmits<{ 'update:fields': [DocField[]] }>()
const t = useT()

// FIELD_TYPES/DOC_MERGE_FIELDS (from ~/utils/docFields) carry their own
// English-only labels used to build stored template data (block type,
// merge-field key) -- these local maps translate the *display* of those
// same type/key values without touching the shared utils file or the
// underlying values that get stored/matched against.
const FIELD_TYPE_LABELS = computed<Record<DocFieldType, string>>(() => ({
  heading: t('Heading', 'Título'),
  text: t('Text', 'Texto'),
  short_text: t('Short answer', 'Respuesta corta'),
  long_text: t('Long answer', 'Respuesta larga'),
  checkbox: t('Checkbox', 'Casilla de verificación'),
  choice: t('Options', 'Opciones'),
  scale: t('Number scale', 'Escala numérica'),
  rating: t('Rating', 'Valoración'),
  date: t('Date', 'Fecha'),
  signature: t('Signature', 'Firma'),
}))
const MERGE_FIELD_LABELS = computed<Record<string, string>>(() => ({
  first_name: t('First name', 'Nombre'),
  last_name: t('Last name', 'Apellidos'),
  date_of_birth: t('Date of birth', 'Fecha de nacimiento'),
  email: t('Email', 'Correo electrónico'),
  clinic_name: t('Clinic name', 'Nombre de la clínica'),
  today: t("Today's date", 'Fecha de hoy'),
}))
// Keyed by LINKABLE_PATIENT_FIELDS -- a key missing here renders as a bare
// "Link to:" with nothing after it, which is how the two name fields first
// appeared when they were added to that list alone.
const LINKABLE_FIELD_LABELS = computed<Record<string, string>>(() => ({
  first_name: t('First name', 'Nombre'),
  last_name: t('Last name', 'Apellidos'),
  date_of_birth: t('Date of birth', 'Fecha de nacimiento'),
  email: t('Email', 'Correo electrónico'),
  address: t('Address', 'Dirección'),
  city: t('City', 'Ciudad'),
  postal_code: t('Postal code', 'Código postal'),
  country: t('Country', 'País'),
  national_id: t('National ID', 'DNI/NIE'),
  occupation: t('Occupation', 'Ocupación'),
  gender: t('Gender', 'Género'),
  emergency_contact: t('Emergency contact', 'Contacto de emergencia'),
}))

function update(index: number, patch: Partial<DocField>) {
  const next = props.fields.map((f, i) => (i === index ? { ...f, ...patch } : f))
  emit('update:fields', next)
}

function move(index: number, dir: -1 | 1) {
  const next = [...props.fields]
  const target = index + dir
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target], next[index]]
  emit('update:fields', next)
}

const draggedIndex = ref<number | null>(null)

function onDragStart(index: number) {
  draggedIndex.value = index
}

function onDragOver(index: number) {
  if (draggedIndex.value === null || draggedIndex.value === index) return
  const next = [...props.fields]
  const [moved] = next.splice(draggedIndex.value, 1)
  next.splice(index, 0, moved)
  draggedIndex.value = index
  emit('update:fields', next)
}

function onDragEnd() {
  draggedIndex.value = null
}

// A new id, or Vue's :key would collide and the two blocks would share
// state -- typing in one would type in the other.
function duplicate(index: number) {
  const source = props.fields[index]
  const copy: DocField = { ...source, id: crypto.randomUUID(), options: source.options ? [...source.options] : undefined }
  const next = [...props.fields]
  next.splice(index + 1, 0, copy)
  emit('update:fields', next)
}

function remove(index: number) {
  // Only asks once the block has something in it. Confirming the removal of
  // an empty block someone just added by mistake is noise; losing a written
  // question with its options to a mis-click is not.
  const field = props.fields[index]
  const hasContent = field.label.trim() !== '' || (field.options ?? []).length > 0
  if (hasContent && !confirm(t('Remove this block?', '¿Eliminar este bloque?'))) return
  emit(
    'update:fields',
    props.fields.filter((_, i) => i !== index),
  )
}

function addBlock(type: DocFieldType) {
  emit('update:fields', [...props.fields, newField(type)])
}

function insertMergeField(index: number, key: string) {
  update(index, { label: `${props.fields[index].label}{{${key}}}` })
}

function addOption(index: number) {
  const options = [...(props.fields[index].options ?? [])]
  options.push(`${t('Option', 'Opción')} ${options.length + 1}`)
  update(index, { options })
}

function updateOption(index: number, optIndex: number, value: string) {
  const options = [...(props.fields[index].options ?? [])]
  options[optIndex] = value
  update(index, { options })
}

function removeOption(index: number, optIndex: number) {
  const options = (props.fields[index].options ?? []).filter((_, i) => i !== optIndex)
  update(index, { options })
}

function selectChoice(index: number, option: string) {
  update(index, { value: option })
}

function toggleChoiceOption(index: number, option: string) {
  const current = Array.isArray(props.fields[index].value) ? [...(props.fields[index].value as string[])] : []
  const i = current.indexOf(option)
  if (i === -1) current.push(option)
  else current.splice(i, 1)
  update(index, { value: current })
}

// "Other" is represented as a value not present in `options`, rather than a
// separate field -- for multi-select that's whichever array entry isn't a
// known option, for single-select it's the value itself.
function isOtherActive(field: DocField): boolean {
  const options = field.options ?? []
  if (field.multiple) return Array.isArray(field.value) && (field.value as string[]).some((v) => !options.includes(v))
  return typeof field.value === 'string' && !options.includes(field.value)
}

function otherText(field: DocField): string {
  const options = field.options ?? []
  if (field.multiple) return (Array.isArray(field.value) ? (field.value as string[]) : []).find((v) => !options.includes(v)) ?? ''
  return typeof field.value === 'string' && !options.includes(field.value) ? field.value : ''
}

function toggleOther(index: number) {
  const field = props.fields[index]
  const options = field.options ?? []
  if (field.multiple) {
    const arr = Array.isArray(field.value) ? [...(field.value as string[])] : []
    const oi = arr.findIndex((v) => !options.includes(v))
    if (oi === -1) arr.push('')
    else arr.splice(oi, 1)
    update(index, { value: arr })
  } else {
    update(index, { value: isOtherActive(field) ? null : '' })
  }
}

function updateOtherText(index: number, text: string) {
  const field = props.fields[index]
  const options = field.options ?? []
  if (field.multiple) {
    const arr = Array.isArray(field.value) ? [...(field.value as string[])] : []
    const oi = arr.findIndex((v) => !options.includes(v))
    if (oi === -1) arr.push(text)
    else arr[oi] = text
    update(index, { value: arr })
  } else {
    update(index, { value: text })
  }
}

const showAddMenu = ref(false)
</script>

<template>
  <div class="space-y-4">
    <div v-for="(field, i) in fields" :key="field.id">
      <!-- Build mode: configure the block -->
      <div
        v-if="mode === 'build'"
        class="rounded-md border border-line p-3"
        :class="{ 'opacity-40': draggedIndex === i }"
        @dragover.prevent="onDragOver(i)"
        @drop.prevent
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span
              draggable="true"
              class="cursor-grab select-none text-ink-faint hover:text-ink-muted active:cursor-grabbing"
              :title="t('Drag to reorder', 'Arrastrar para reordenar')"
              @dragstart="onDragStart(i)"
              @dragend="onDragEnd"
              >⠿</span
            >
            <span class="rounded bg-chip-bg px-1.5 py-0.5 text-xs font-medium text-ink-muted">
              {{ FIELD_TYPE_LABELS[field.type] }}
            </span>
          </div>
          <div class="flex items-center gap-1 text-xs text-ink-faint">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-ctlSm hover:bg-surface-subtle hover:text-ink-700 disabled:opacity-25 disabled:hover:bg-transparent"
              :disabled="i === 0"
              :title="t('Move up', 'Subir')"
              :aria-label="t('Move up', 'Subir')"
              @click="move(i, -1)"
            >
              &uarr;
            </button>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-ctlSm hover:bg-surface-subtle hover:text-ink-700 disabled:opacity-25 disabled:hover:bg-transparent"
              :disabled="i === fields.length - 1"
              :title="t('Move down', 'Bajar')"
              :aria-label="t('Move down', 'Bajar')"
              @click="move(i, 1)"
            >
              &darr;
            </button>
            <button
              type="button"
              class="flex h-7 items-center justify-center rounded-ctlSm px-1.5 text-[11px] font-medium hover:bg-surface-subtle hover:text-ink-700"
              :title="t('Duplicate block', 'Duplicar bloque')"
              @click="duplicate(i)"
            >
              {{ t('Duplicate', 'Duplicar') }}
            </button>
            <UiIconBtn icon="trash" tone="danger" :label="t('Remove block', 'Eliminar bloque')" @click="remove(i)" />
          </div>
        </div>

        <textarea
          v-if="field.type === 'text'"
          :value="field.label"
          rows="2"
          :placeholder="t('Text content…', 'Contenido de texto…')"
          class="mt-2 w-full rounded-md border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @input="update(i, { label: ($event.target as HTMLTextAreaElement).value })"
        ></textarea>
        <input
          v-else
          :value="field.label"
          type="text"
          :placeholder="field.type === 'heading' ? t('Heading text…', 'Texto del título…') : t('Question / label…', 'Pregunta / etiqueta…')"
          class="mt-2 w-full rounded-md border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @input="update(i, { label: ($event.target as HTMLInputElement).value })"
        />

        <div v-if="field.type === 'choice'" class="mt-2 space-y-1.5">
          <div v-for="(opt, oi) in field.options ?? []" :key="oi" class="flex items-center gap-1.5">
            <input
              :value="opt"
              type="text"
              class="w-full rounded-md border border-line-control px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              @input="updateOption(i, oi, ($event.target as HTMLInputElement).value)"
            />
            <button type="button" class="text-xs text-ink-faint hover:text-danger-text" @click="removeOption(i, oi)">✕</button>
          </div>
          <button type="button" class="text-xs font-medium text-brand-text hover:text-brand-hover" @click="addOption(i)">+ {{ t('Add option', 'Añadir opción') }}</button>
          <label class="flex items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              :checked="field.multiple"
              class="rounded border-line-control text-brand-text focus:ring-brand"
              @change="update(i, { multiple: ($event.target as HTMLInputElement).checked, value: ($event.target as HTMLInputElement).checked ? [] : null })"
            />
            {{ t('Allow multiple selections', 'Permitir varias selecciones') }}
          </label>
          <label class="flex items-center gap-1.5 text-xs text-ink-muted">
            <input
              type="checkbox"
              :checked="field.allowOther"
              class="rounded border-line-control text-brand-text focus:ring-brand"
              @change="update(i, { allowOther: ($event.target as HTMLInputElement).checked })"
            />
            {{ t('Allow "Other" (free text)', 'Permitir "Otro" (texto libre)') }}
          </label>
        </div>

        <div class="mt-2 flex items-center gap-3">
          <select
            v-if="STATIC_BLOCK_TYPES.includes(field.type)"
            class="rounded border-line-control text-xs text-brand-text"
            @change="
              (e) => {
                const v = (e.target as HTMLSelectElement).value
                if (v) insertMergeField(i, v)
                ;(e.target as HTMLSelectElement).value = ''
              }
            "
          >
            <option value="">+ {{ t('Insert field', 'Insertar campo') }}</option>
            <option v-for="f in DOC_MERGE_FIELDS" :key="f.key" :value="f.key">{{ MERGE_FIELD_LABELS[f.key] }}</option>
          </select>
          <label v-else class="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" :checked="field.required" class="rounded border-line-control text-brand-text focus:ring-brand" @change="update(i, { required: ($event.target as HTMLInputElement).checked })" />
            {{ t('Required', 'Obligatorio') }}
          </label>
        </div>

        <div v-if="LINKABLE_FIELD_TYPES.includes(field.type)" class="mt-2">
          <select
            :value="field.patientField ?? ''"
            class="rounded border-line-control bg-surface text-xs"
            :class="field.patientField ? 'text-brand-text' : 'text-ink-muted'"
            @change="update(i, { patientField: ($event.target as HTMLSelectElement).value || undefined })"
          >
            <option value="">{{ t("Don't link to a patient field", 'No vincular a un campo del paciente') }}</option>
            <option v-for="f in LINKABLE_PATIENT_FIELDS" :key="f.key" :value="f.key">{{ t('Link to', 'Vincular a') }}: {{ LINKABLE_FIELD_LABELS[f.key] }}</option>
          </select>
        </div>
      </div>

      <!-- Fill mode: answer the block -->
      <div v-else>
        <h2 v-if="field.type === 'heading'" class="text-lg font-semibold text-ink-900">{{ field.label }}</h2>
        <p v-else-if="field.type === 'text'" class="whitespace-pre-wrap text-sm text-ink-700">{{ field.label }}</p>

        <div v-else-if="field.type === 'checkbox'">
          <label class="flex items-start gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              :checked="!!field.value"
              class="mt-0.5 rounded border-line-control text-brand-text focus:ring-brand"
              @change="update(i, { value: ($event.target as HTMLInputElement).checked })"
            />
            {{ field.label }}<span v-if="field.required" class="text-danger-text">*</span>
          </label>
        </div>

        <div v-else-if="field.type === 'choice'">
          <label class="block text-sm font-medium text-ink-700">
            {{ field.label }}<span v-if="field.required" class="text-danger-text">*</span>
          </label>
          <div class="mt-1.5 space-y-1.5">
            <label v-for="(opt, oi) in field.options ?? []" :key="oi" class="flex items-center gap-2 text-sm text-ink-700">
              <input
                v-if="field.multiple"
                type="checkbox"
                :checked="Array.isArray(field.value) && (field.value as string[]).includes(opt)"
                class="rounded border-line-control text-brand-text focus:ring-brand"
                @change="toggleChoiceOption(i, opt)"
              />
              <input
                v-else
                type="radio"
                :name="field.id"
                :checked="field.value === opt"
                class="border-line-control text-brand-text focus:ring-brand"
                @change="selectChoice(i, opt)"
              />
              {{ opt }}
            </label>
            <div v-if="field.allowOther">
              <label class="flex items-center gap-2 text-sm text-ink-700">
                <input
                  v-if="field.multiple"
                  type="checkbox"
                  :checked="isOtherActive(field)"
                  class="rounded border-line-control text-brand-text focus:ring-brand"
                  @change="toggleOther(i)"
                />
                <input
                  v-else
                  type="radio"
                  :name="field.id"
                  :checked="isOtherActive(field)"
                  class="border-line-control text-brand-text focus:ring-brand"
                  @change="toggleOther(i)"
                />
                {{ t('Other', 'Otro') }}
              </label>
              <input
                v-if="isOtherActive(field)"
                type="text"
                :value="otherText(field)"
                :placeholder="t('Please specify…', 'Por favor, especifica…')"
                class="mt-1 w-full rounded-md border border-line-control px-2 py-1 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                @input="updateOtherText(i, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>
        </div>

        <div v-else-if="field.type === 'scale'">
          <label class="block text-sm font-medium text-ink-700">
            {{ field.label }}<span v-if="field.required" class="text-danger-text">*</span>
          </label>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <button
              v-for="n in 11"
              :key="n"
              type="button"
              class="h-8 w-8 rounded-md border text-sm font-medium"
              :class="field.value === n - 1 ? 'border-brand bg-brand text-white' : 'border-line-control text-ink-700 hover:border-brand'"
              @click="update(i, { value: n - 1 })"
            >
              {{ n - 1 }}
            </button>
          </div>
        </div>

        <div v-else-if="field.type === 'rating'">
          <label class="block text-sm font-medium text-ink-700">
            {{ field.label }}<span v-if="field.required" class="text-danger-text">*</span>
          </label>
          <div class="mt-1.5 flex gap-1">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              class="text-2xl leading-none"
              :class="typeof field.value === 'number' && field.value >= n ? 'text-amber-400' : 'text-ink-faint hover:text-amber-300'"
              @click="update(i, { value: n })"
            >
              ★
            </button>
          </div>
        </div>

        <div v-else>
          <label class="block text-sm font-medium text-ink-700">
            {{ field.label }}<span v-if="field.required" class="text-danger-text">*</span>
          </label>
          <textarea
            v-if="field.type === 'long_text'"
            :value="field.value as string"
            rows="3"
            class="mt-1 w-full rounded-md border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @input="update(i, { value: ($event.target as HTMLTextAreaElement).value })"
          ></textarea>
          <DocDateInput
            v-else-if="field.type === 'date'"
            :model-value="field.value as string | null"
            @update:model-value="(v) => update(i, { value: v })"
          />
          <SignaturePad
            v-else-if="field.type === 'signature'"
            :model-value="field.value as string | null"
            class="mt-1"
            @update:model-value="(v) => update(i, { value: v })"
          />
          <input
            v-else
            type="text"
            :value="field.value as string"
            class="mt-1 w-full rounded-md border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            @input="update(i, { value: ($event.target as HTMLInputElement).value })"
          />
        </div>
      </div>
    </div>

    <div v-if="mode === 'build'" class="relative">
      <button type="button" class="rounded-md border border-dashed border-line-control px-3 py-1.5 text-sm text-ink-muted hover:border-brand hover:text-brand-text" @click="showAddMenu = !showAddMenu">
        + {{ t('Add block', 'Añadir bloque') }}
      </button>
      <div v-if="showAddMenu" class="absolute left-0 z-10 mt-1 w-40 rounded-md border border-line bg-surface py-1 shadow-lg">
        <button
          v-for="ft in FIELD_TYPES"
          :key="ft.type"
          type="button"
          class="block w-full px-3 py-1.5 text-left text-sm text-ink-700 hover:bg-surface-subtle"
          @click="addBlock(ft.type); showAddMenu = false"
        >
          {{ FIELD_TYPE_LABELS[ft.type] }}
        </button>
      </div>
    </div>

    <p v-if="mode === 'build' && fields.length === 0" class="text-sm text-ink-faint">{{ t('No blocks yet — add one below.', 'Aún no hay bloques — añade uno abajo.') }}</p>
  </div>
</template>
