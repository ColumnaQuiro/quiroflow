<script setup lang="ts">
// A patient's form, read only: what they answered and signed. The record
// listed a signed form as "Firmado" with no way to see it. Every block type
// DocBlocks fills is shown as it was answered; a signature and a drawing on
// a diagram are the images the patient made (the drawing is the strokes
// alone, so it is laid over the diagram it was drawn on, as DocImageDraw
// shows it).
import type { DocField } from '../../utils/docFields'

const props = defineProps<{ docId: string }>()
const emit = defineEmits<{ close: [] }>()
const supabase = useSupabaseClient()
const t = useT()
const { context } = usePractitionerContext()

const title = ref('')
const completedAt = ref<string | null>(null)
const fields = ref<DocField[]>([])
const loading = ref(true)
const loadError = ref('')

onMounted(async () => {
  const { data, error } = await supabase.from('patient_docs').select('title, completed_at, fields').eq('id', props.docId).maybeSingle()
  if (error || !data) {
    loadError.value = t('Could not open the form.', 'No se ha podido abrir el formulario.')
    loading.value = false
    return
  }
  const doc = data as { title: string | null; completed_at: string | null; fields: DocField[] | null }
  title.value = doc.title ?? ''
  completedAt.value = doc.completed_at
  fields.value = Array.isArray(doc.fields) ? doc.fields : []
  loading.value = false
})

const when = computed(() => (completedAt.value ? new Date(completedAt.value).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: context.value?.timeZone ?? DEFAULT_CLINIC_TIMEZONE }) : null))
const imageOf = (path: string | undefined) => (path ? supabase.storage.from('doc-images').getPublicUrl(path).data.publicUrl : null)
function answer(f: DocField): string {
  const v = f.value
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return '—'
  if (Array.isArray(v)) return v.join(', ')
  if (f.type === 'date' && typeof v === 'string') return new Date(`${v.slice(0, 10)}T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  if (f.type === 'rating' && typeof v === 'number') return '★'.repeat(v) + '☆'.repeat(Math.max(0, 5 - v))
  return String(v)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="doc-view-sheet" @click.self="emit('close')">
    <div class="flex max-h-[92%] w-full flex-col overflow-hidden rounded-t-[22px] bg-surface shadow-popover md:max-w-[640px] md:rounded-[18px]" role="dialog" aria-modal="true" :aria-label="title || t('Form', 'Formulario')">
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-3.5">
        <div class="min-w-0">
          <p class="truncate text-[17px] font-semibold text-ink-900">{{ title || t('Form', 'Formulario') }}</p>
          <p v-if="when" class="text-[12.5px] text-success-text">{{ t('Signed', 'Firmado') }} · {{ when }}</p>
          <p v-else-if="!loading" class="text-[12.5px] text-warning-text">{{ t('Not signed yet', 'Aún sin firmar') }}</p>
        </div>
        <button type="button" class="-mr-1 flex h-9 shrink-0 items-center px-2 text-[14px] font-semibold text-brand-text" data-cy="doc-view-close" @click="emit('close')">{{ t('Close', 'Cerrar') }}</button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3" style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)">
        <AppSkeletonList v-if="loading" :rows="4" />
        <p v-else-if="loadError" class="text-[13.5px] text-danger-text">{{ loadError }}</p>
        <div v-else class="flex flex-col gap-3" data-cy="doc-view-fields">
          <template v-for="f in fields" :key="f.id">
            <h3 v-if="f.type === 'heading'" class="pt-1 text-[15.5px] font-semibold text-ink-900">{{ f.label }}</h3>
            <p v-else-if="f.type === 'text'" class="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-700">{{ f.label }}</p>
            <p v-else-if="f.type === 'checkbox'" class="flex items-start gap-2 text-[14px] text-ink-900">
              <span class="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border" :class="f.value ? 'border-brand bg-brand text-white' : 'border-line-control'" aria-hidden="true">
                <svg v-if="f.value" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
              <span>{{ f.label }}<span class="sr-only">: {{ f.value ? t('yes', 'sí') : t('no', 'no') }}</span></span>
            </p>
            <div v-else-if="f.type === 'signature'">
              <p class="text-[12px] font-medium text-ink-muted">{{ f.label }}</p>
              <img v-if="typeof f.value === 'string' && f.value.startsWith('data:image')" :src="f.value" :alt="t('Signature', 'Firma')" class="mt-1 max-h-32 rounded-ctl border border-line bg-white" data-cy="doc-view-signature" />
              <p v-else class="text-[14px] text-ink-faint">—</p>
            </div>
            <div v-else-if="f.type === 'drawable_image'">
              <p class="text-[12px] font-medium text-ink-muted">{{ f.label }}</p>
              <div class="relative mt-1 overflow-hidden rounded-ctl border border-line bg-white">
                <img v-if="imageOf(f.imagePath)" :src="imageOf(f.imagePath)!" alt="" class="block w-full" />
                <img v-if="typeof f.value === 'string' && f.value.startsWith('data:image')" :src="f.value" :alt="t('Marks drawn', 'Marcas dibujadas')" class="absolute inset-0 h-full w-full" />
              </div>
            </div>
            <div v-else>
              <p class="text-[12px] font-medium text-ink-muted">{{ f.label }}</p>
              <p class="whitespace-pre-wrap text-[14.5px] leading-snug" :class="answer(f) === '—' ? 'text-ink-faint' : 'text-ink-900'">{{ answer(f) }}</p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
