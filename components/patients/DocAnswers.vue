<script setup lang="ts">
import type { DocField } from '~/utils/docFields'

// A completed form as a practitioner reads it: each question with its answer,
// nothing to click. DocBlocks' fill mode is the form itself, every answer an
// input that can be changed by brushing it -- right for filling it in, wrong
// for keeping it open beside a visit note while the patient talks.
//
// 'text' blocks are left out: they are the form's instructions and consent
// wording, the same on every copy, and they buried the answers between them.
defineProps<{ fields: DocField[] }>()

const t = useT()
const { formatLongDate } = useDates()

function answer(field: DocField): string | null {
  const v = field.value
  if (v === null || v === undefined || v === '') return null
  switch (field.type) {
    case 'checkbox':
      return v ? t('Yes', 'Sí') : t('No', 'No')
    case 'choice':
      // An "Other" answer is stored as its own text among the options, so it
      // reads correctly without being told apart.
      return Array.isArray(v) ? (v.length ? v.join(', ') : null) : String(v)
    case 'scale':
      return `${v} / 10`
    case 'rating':
      return `${v} / 5`
    case 'date':
      // Midday, local: a bare YYYY-MM-DD parses as UTC midnight, which is
      // the day before anywhere west of Greenwich.
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? formatLongDate(`${v.slice(0, 10)}T12:00:00`) : String(v)
    default:
      return String(v)
  }
}
</script>

<template>
  <dl class="space-y-3" data-cy="doc-answers">
    <template v-for="field in fields" :key="field.id">
      <h3 v-if="field.type === 'heading'" class="pt-2 text-[14px] font-semibold text-ink-900 first:pt-0">{{ field.label }}</h3>
      <div v-else-if="field.type !== 'text'">
        <dt class="text-[12px] font-medium text-ink-muted2">{{ field.label }}</dt>
        <dd class="mt-0.5">
          <template v-if="field.type === 'signature' || field.type === 'drawable_image'">
            <img v-if="field.value" :src="field.value as string" :alt="field.label" class="max-h-48 rounded-ctl border border-line bg-white" />
            <span v-else class="text-[13px] text-ink-faint">—</span>
          </template>
          <p v-else-if="answer(field)" class="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-800">{{ answer(field) }}</p>
          <span v-else class="text-[13px] text-ink-faint">—</span>
        </dd>
      </div>
    </template>
  </dl>
</template>
