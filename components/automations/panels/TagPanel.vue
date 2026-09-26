<script setup lang="ts">
import { FIELD, HINT, LABEL, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'

// Add or remove a tag on the patient's record. Tags are free text in
// patients.tags, so the list offered is the ones the clinic already uses.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const supabase = useSupabaseClient()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)

const known = ref<string[]>([])
onMounted(async () => {
  // A sample is enough to suggest from; this is a datalist, not a filter.
  const { data } = await supabase.from('patients').select('tags').not('tags', 'eq', '{}').limit(1000)
  const all = new Set<string>()
  for (const row of data ?? []) for (const tag of (row.tags as string[] | null) ?? []) if (tag && tag.length < 40) all.add(tag)
  known.value = [...all].sort((a, c) => a.localeCompare(c)).slice(0, 200)
})
const listId = `tags-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div class="flex flex-col gap-4">
    <div :class="SEGMENT_WRAP" role="group">
      <button type="button" :class="segmentBtn(config.mode !== 'remove')" :aria-pressed="config.mode !== 'remove'" @click="set({ mode: 'add' })">{{ t('Add', 'Añadir') }}</button>
      <button type="button" :class="segmentBtn(config.mode === 'remove')" :aria-pressed="config.mode === 'remove'" data-test="tag-remove" @click="set({ mode: 'remove' })">{{ t('Remove', 'Quitar') }}</button>
    </div>
    <label :class="LABEL">
      {{ t('Tag', 'Etiqueta') }}
      <input :class="FIELD" :list="listId" :value="config.tag ?? ''" data-test="tag-input" @input="set({ tag: ($event.target as HTMLInputElement).value })" />
      <datalist :id="listId">
        <option v-for="tag in known" :key="tag" :value="tag" />
      </datalist>
    </label>
    <p :class="HINT">{{ t('Removing tags from an automation does not depend on the "Remove tags" permission: whoever sets up the automation decides.', 'Quitar etiquetas desde una automatización no depende del permiso «Quitar etiquetas»: lo decide quien la configura.') }}</p>
  </div>
</template>
