<script setup lang="ts">
import { openWhenReady } from '../../utils/openWhenReady'
import { STAFF_DOCUMENTS_BUCKET, staffDocumentCategoryLabel, staffDocumentName, type StaffDocument } from '../../utils/staffDocuments'

// Mis documentos: the papers the clinic keeps for this person -- nóminas,
// contract, certificates -- in Mi jornada on the web (/jornada?tab=mine) and
// in the app (mobile/pages/jornada.vue), the same component in both. RLS
// shows only their own and never a parte de baja. Opening one for the first
// time tells the owner it was seen (mark_staff_document_viewed).
const props = defineProps<{ accountId: string; teamMemberId: string }>()
const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))
const supabase = useSupabaseClient()

const docs = ref<StaffDocument[]>([])
const loaded = ref(false)
const error = ref('')
async function load() {
  const { data, error: e } = await supabase
    .from('staff_documents')
    .select('id, team_member_id, category, period, title, storage_path, file_name, size_bytes, uploaded_at, first_viewed_at')
    .eq('account_id', props.accountId)
    .eq('team_member_id', props.teamMemberId)
    .order('uploaded_at', { ascending: false })
  error.value = e ? t("Couldn't load your documents.", 'No se han podido cargar tus documentos.') : ''
  docs.value = (data as StaffDocument[] | null) ?? []
  loaded.value = true
}
onMounted(load)

const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' })
const busy = ref<string | null>(null)
async function open(d: StaffDocument) {
  busy.value = d.id
  try {
    await openWhenReady(async () => {
      const { data } = await supabase.storage.from(STAFF_DOCUMENTS_BUCKET).createSignedUrl(d.storage_path, 60 * 5)
      return data?.signedUrl
    })
    if (!d.first_viewed_at) {
      await supabase.rpc('mark_staff_document_viewed', { p_document_id: d.id })
      d.first_viewed_at = new Date().toISOString()
    }
  } catch {
    error.value = t("Couldn't open it. Try again.", 'No se ha podido abrir. Inténtalo de nuevo.')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section class="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3" data-cy="my-documents" :data-ready="loaded ? 'true' : undefined">
    <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('My documents', 'Mis documentos') }}</h2>
    <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>
    <div v-if="!loaded" aria-busy="true"><UiSkeleton class="h-10 w-full rounded-ctl" /></div>
    <p v-else-if="!docs.length" class="text-[13px] text-ink-muted" data-cy="my-documents-empty">{{ t('Your payslips and contract will be here when the clinic uploads them.', 'Aquí estarán tus nóminas y tu contrato cuando la clínica los suba.') }}</p>
    <ul v-else class="-mx-1 flex flex-col">
      <li v-for="d in docs" :key="d.id">
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-3 rounded-ctl px-1 py-2 text-left hover:bg-surface-subtle disabled:opacity-60"
          :disabled="busy === d.id"
          data-cy="my-documents-open"
          :data-category="d.category"
          @click="open(d)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[14px] font-semibold text-ink-900">{{ staffDocumentName(d, t, locale) }}</span>
            <span class="block text-[12px] text-ink-muted">{{ staffDocumentCategoryLabel(d.category, t) }} · {{ fmt(d.uploaded_at) }}</span>
          </span>
          <UiPill v-if="!d.first_viewed_at" tone="brand" data-cy="my-documents-new">{{ t('New', 'Nuevo') }}</UiPill>
        </button>
      </li>
    </ul>
  </section>
</template>
