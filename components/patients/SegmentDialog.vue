<script setup lang="ts">
// Name a segment, new or existing, and say whether the team sees it.
const props = defineProps<{
  mode: 'create' | 'rename'
  initialName?: string
  initialShared?: boolean
  busy?: boolean
}>()
const emit = defineEmits<{ save: [name: string, shared: boolean]; cancel: [] }>()
const t = useT()

const name = ref(props.initialName ?? '')
const shared = ref(props.initialShared ?? true)
const input = ref<HTMLInputElement | null>(null)
// After the dialog's own onMounted, which focuses Cancel.
onMounted(() => nextTick(() => input.value?.focus()))

const valid = computed(() => name.value.trim().length > 0 && name.value.trim().length <= 80)
function save() {
  if (valid.value && !props.busy) emit('save', name.value.trim(), shared.value)
}
</script>

<template>
  <UiConfirmDialog
    :title="mode === 'create' ? t('Save as segment', 'Guardar como segmento') : t('Rename segment', 'Renombrar segmento')"
    :confirm-label="t('Save', 'Guardar')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :disabled="!valid"
    :busy="busy"
    @confirm="save"
    @cancel="emit('cancel')"
  >
    <p v-if="mode === 'create'" class="text-[13px] text-ink-muted">
      {{ t('Saves the filters on screen. Opening the segment later shows whoever matches them then.', 'Guarda los filtros actuales. Al abrir el segmento verás a quien cumpla esos filtros en ese momento.') }}
    </p>
    <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('Name', 'Nombre') }}
      <input
        ref="input"
        v-model="name"
        data-cy="segment-name"
        maxlength="80"
        :placeholder="t('e.g. Bono almost used up', 'p. ej. Bono casi gastado')"
        class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        @keydown.enter.prevent="save"
      />
    </label>
    <label class="flex items-start gap-2 text-[13px] text-ink-700">
      <input v-model="shared" data-cy="segment-shared" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" />
      <span>
        {{ t('Share with the team', 'Compartir con el equipo') }}
        <span class="block text-[12px] text-ink-faint">{{ t('Untick to keep it to yourself.', 'Desmárcalo para que solo lo veas tú.') }}</span>
      </span>
    </label>
  </UiConfirmDialog>
</template>
