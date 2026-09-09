<script setup lang="ts">
// Shared "here's what this import will do" confirmation table.
//
// Every importer used to differ here: some (bonos, patients, appointments)
// scanned first and showed a table you had to approve, others went straight
// from Connect to writing rows. That inconsistency is what made the bonos
// mistakes hard to catch -- you only saw what had happened after it had
// happened. This component is the one preview layout, so every importer can
// stop at the same confirmation step: a few headline counts, a sample of the
// actual rows, and an explicit Apply.

interface PreviewStat {
  label: string
  value: number | string
  // 'good' marks the number that will actually be written (green); everything
  // else -- skipped, already imported, unmatched -- stays neutral.
  tone?: 'good' | 'plain'
}

interface PreviewColumn {
  key: string
  label: string
  /** Renders the cell with wrapped, newline-preserving text (note bodies). */
  wrap?: boolean
}

const props = withDefaults(
  defineProps<{
    stats: PreviewStat[]
    columns: PreviewColumn[]
    /** Display rows, already formatted as strings, keyed by column key. */
    rows: Record<string, string>[]
    applyLabel: string
    /** Label for the row-count line under the table, e.g. "more payments". */
    moreLabel: string
    sampleLimit?: number
    applyDisabled?: boolean
    /**
     * Lets Apply stay live with no sample rows, for importers whose work
     * isn't all row-shaped (the forms import can still have templates to
     * create once every response is already in).
     */
    allowEmptyApply?: boolean
  }>(),
  { sampleLimit: 10, applyDisabled: false, allowEmptyApply: false },
)

const emit = defineEmits<{ apply: []; cancel: [] }>()

const t = useT()

const sample = computed(() => props.rows.slice(0, props.sampleLimit))
const hiddenCount = computed(() => Math.max(0, props.rows.length - props.sampleLimit))
</script>

<template>
  <div class="space-y-4">
    <slot name="warning" />

    <div class="rounded-lg border border-line bg-surface p-4">
      <dl class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div v-for="stat in stats" :key="stat.label">
          <dt class="text-ink-muted2">{{ stat.label }}</dt>
          <dd class="font-medium" :class="stat.tone === 'good' ? 'text-success-text' : 'text-ink-900'">{{ stat.value }}</dd>
        </div>
      </dl>
      <slot name="summary-footer" />
    </div>

    <div v-if="rows.length > 0" class="overflow-x-auto rounded-lg border border-line bg-surface">
      <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
        {{ t('Sample of changes', 'Muestra de cambios') }}
      </div>
      <table class="w-full text-sm">
        <thead class="border-b border-line bg-surface-subtle text-left text-xs font-medium uppercase tracking-wide text-ink-muted2">
          <tr>
            <th v-for="col in columns" :key="col.key" class="px-3 py-2">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line-divider">
          <tr v-for="(row, i) in sample" :key="i">
            <td
              v-for="col in columns"
              :key="col.key"
              class="px-3 py-2 text-ink-900"
              :class="col.wrap ? 'whitespace-pre-line' : 'whitespace-nowrap'"
            >
              {{ row[col.key] }}
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="hiddenCount > 0" class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">+ {{ hiddenCount }} {{ moreLabel }}</p>
    </div>

    <div v-else-if="!allowEmptyApply" class="rounded-lg border border-line bg-surface p-6 text-center text-sm text-ink-muted2">
      {{ t('Nothing to import — everything here is already up to date.', 'Nada que importar: todo está ya actualizado.') }}
    </div>

    <slot name="note" />

    <div class="flex gap-3">
      <button
        type="button"
        :disabled="applyDisabled || (rows.length === 0 && !allowEmptyApply)"
        class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
        @click="emit('apply')"
      >
        {{ applyLabel }}
      </button>
      <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="emit('cancel')">
        {{ t('Cancel', 'Cancelar') }}
      </button>
    </div>
  </div>
</template>
