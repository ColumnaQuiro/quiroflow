<script setup lang="ts">
import type { DocField, DocFieldType } from '~/utils/docFields'

const props = defineProps<{ fields: DocField[]; mode: 'build' | 'fill' }>()
const emit = defineEmits<{ 'update:fields': [DocField[]] }>()

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

function remove(index: number) {
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
  options.push(`Option ${options.length + 1}`)
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

const showAddMenu = ref(false)
</script>

<template>
  <div class="space-y-4">
    <div v-for="(field, i) in fields" :key="field.id">
      <!-- Build mode: configure the block -->
      <div
        v-if="mode === 'build'"
        class="rounded-md border border-gray-200 p-3"
        :class="{ 'opacity-40': draggedIndex === i }"
        @dragover.prevent="onDragOver(i)"
        @drop.prevent
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span
              draggable="true"
              class="cursor-grab select-none text-gray-300 hover:text-gray-500 active:cursor-grabbing"
              title="Drag to reorder"
              @dragstart="onDragStart(i)"
              @dragend="onDragEnd"
              >⠿</span
            >
            <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
              {{ FIELD_TYPES.find((t) => t.type === field.type)?.label }}
            </span>
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-400">
            <button type="button" class="hover:text-gray-700" :disabled="i === 0" @click="move(i, -1)">&uarr;</button>
            <button type="button" class="hover:text-gray-700" :disabled="i === fields.length - 1" @click="move(i, 1)">&darr;</button>
            <button type="button" class="text-red-500 hover:text-red-700" @click="remove(i)">Remove</button>
          </div>
        </div>

        <textarea
          v-if="field.type === 'text'"
          :value="field.label"
          rows="2"
          placeholder="Text content…"
          class="mt-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          @input="update(i, { label: ($event.target as HTMLTextAreaElement).value })"
        ></textarea>
        <input
          v-else
          :value="field.label"
          type="text"
          :placeholder="field.type === 'heading' ? 'Heading text…' : 'Question / label…'"
          class="mt-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          @input="update(i, { label: ($event.target as HTMLInputElement).value })"
        />

        <div v-if="field.type === 'choice'" class="mt-2 space-y-1.5">
          <div v-for="(opt, oi) in field.options ?? []" :key="oi" class="flex items-center gap-1.5">
            <input
              :value="opt"
              type="text"
              class="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              @input="updateOption(i, oi, ($event.target as HTMLInputElement).value)"
            />
            <button type="button" class="text-xs text-gray-400 hover:text-red-600" @click="removeOption(i, oi)">✕</button>
          </div>
          <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="addOption(i)">+ Add option</button>
          <label class="flex items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              :checked="field.multiple"
              class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              @change="update(i, { multiple: ($event.target as HTMLInputElement).checked, value: ($event.target as HTMLInputElement).checked ? [] : null })"
            />
            Allow multiple selections
          </label>
        </div>

        <div class="mt-2 flex items-center gap-3">
          <select
            v-if="STATIC_BLOCK_TYPES.includes(field.type)"
            class="rounded border-gray-300 text-xs text-indigo-600"
            @change="
              (e) => {
                const v = (e.target as HTMLSelectElement).value
                if (v) insertMergeField(i, v)
                ;(e.target as HTMLSelectElement).value = ''
              }
            "
          >
            <option value="">+ Insert field</option>
            <option v-for="f in DOC_MERGE_FIELDS" :key="f.key" :value="f.key">{{ f.label }}</option>
          </select>
          <label v-else class="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" :checked="field.required" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" @change="update(i, { required: ($event.target as HTMLInputElement).checked })" />
            Required
          </label>
        </div>
      </div>

      <!-- Fill mode: answer the block -->
      <div v-else>
        <h2 v-if="field.type === 'heading'" class="text-lg font-semibold text-gray-900">{{ field.label }}</h2>
        <p v-else-if="field.type === 'text'" class="whitespace-pre-wrap text-sm text-gray-700">{{ field.label }}</p>

        <div v-else-if="field.type === 'checkbox'">
          <label class="flex items-start gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              :checked="!!field.value"
              class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              @change="update(i, { value: ($event.target as HTMLInputElement).checked })"
            />
            {{ field.label }}<span v-if="field.required" class="text-red-500">*</span>
          </label>
        </div>

        <div v-else-if="field.type === 'choice'">
          <label class="block text-sm font-medium text-gray-700">
            {{ field.label }}<span v-if="field.required" class="text-red-500">*</span>
          </label>
          <div class="mt-1.5 space-y-1.5">
            <label v-for="(opt, oi) in field.options ?? []" :key="oi" class="flex items-center gap-2 text-sm text-gray-800">
              <input
                v-if="field.multiple"
                type="checkbox"
                :checked="Array.isArray(field.value) && (field.value as string[]).includes(opt)"
                class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                @change="toggleChoiceOption(i, opt)"
              />
              <input
                v-else
                type="radio"
                :name="field.id"
                :checked="field.value === opt"
                class="border-gray-300 text-indigo-600 focus:ring-indigo-500"
                @change="selectChoice(i, opt)"
              />
              {{ opt }}
            </label>
          </div>
        </div>

        <div v-else-if="field.type === 'scale'">
          <label class="block text-sm font-medium text-gray-700">
            {{ field.label }}<span v-if="field.required" class="text-red-500">*</span>
          </label>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <button
              v-for="n in 11"
              :key="n"
              type="button"
              class="h-8 w-8 rounded-md border text-sm font-medium"
              :class="field.value === n - 1 ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:border-indigo-400'"
              @click="update(i, { value: n - 1 })"
            >
              {{ n - 1 }}
            </button>
          </div>
        </div>

        <div v-else-if="field.type === 'rating'">
          <label class="block text-sm font-medium text-gray-700">
            {{ field.label }}<span v-if="field.required" class="text-red-500">*</span>
          </label>
          <div class="mt-1.5 flex gap-1">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              class="text-2xl leading-none"
              :class="typeof field.value === 'number' && field.value >= n ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'"
              @click="update(i, { value: n })"
            >
              ★
            </button>
          </div>
        </div>

        <div v-else>
          <label class="block text-sm font-medium text-gray-700">
            {{ field.label }}<span v-if="field.required" class="text-red-500">*</span>
          </label>
          <textarea
            v-if="field.type === 'long_text'"
            :value="field.value as string"
            rows="3"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            @input="update(i, { value: ($event.target as HTMLTextAreaElement).value })"
          ></textarea>
          <input
            v-else-if="field.type === 'date'"
            type="date"
            :value="field.value as string"
            class="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            @input="update(i, { value: ($event.target as HTMLInputElement).value })"
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
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            @input="update(i, { value: ($event.target as HTMLInputElement).value })"
          />
        </div>
      </div>
    </div>

    <div v-if="mode === 'build'" class="relative">
      <button type="button" class="rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600" @click="showAddMenu = !showAddMenu">
        + Add block
      </button>
      <div v-if="showAddMenu" class="absolute left-0 z-10 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
        <button
          v-for="t in FIELD_TYPES"
          :key="t.type"
          type="button"
          class="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
          @click="addBlock(t.type); showAddMenu = false"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <p v-if="mode === 'build' && fields.length === 0" class="text-sm text-gray-400">No blocks yet — add one below.</p>
  </div>
</template>
