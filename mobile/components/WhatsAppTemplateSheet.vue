<script setup lang="ts">
// "Send a template" in the app's Inbox thread: the one thing WhatsApp lets a
// clinic send outside the 24-hour window, or to start a conversation.
//
// The web's SendWhatsAppModal, as a bottom sheet, doing exactly what it does:
// the account's APPROVED templates from /api/whatsapp/templates, {{1}}
// prefilled with the patient's first name and every variable editable, an
// attachment from the patient's files when the template has a media header,
// coordinates when it has a location one -- and the send through
// /api/whatsapp/send, which also refuses a minor or a do-not-contact patient
// and records the message in the thread.
//
// useStaffFetch, not a plain $fetch: the app has no server behind its own
// origin, so the URL has to be made absolute against apiBase and carry the
// session as a Bearer token.

interface Template {
  name: string
  language: string
  category: string
  bodyText: string
  variableCount: number
  mediaHeaderFormat: 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'LOCATION' | null
}

const props = defineProps<{
  /** Either a patient, or a number no patient has yet. */
  patientId?: string | null
  phoneNumber?: string | null
  patientFirstName?: string
  /** Chosen on opening when approved (Recordatorios: the account's recall template), in the patient's language if there is that variant. */
  defaultTemplateName?: string | null
  patientPreferredLanguage?: string | null
}>()
const emit = defineEmits<{ close: []; sent: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { keyboardHeight } = useKeyboardInset()

const templates = ref<Template[]>([])
const loading = ref(true)
const loadError = ref('')
const selectedKey = ref('')
const variables = ref<string[]>([])
const files = ref<{ id: string; file_name: string }[]>([])
const attachmentFileId = ref('')
const latitude = ref('')
const longitude = ref('')
const locationName = ref('')
const locationAddress = ref('')
const sending = ref(false)
const error = ref('')

// Name alone is not unique: the same template can be approved in several
// languages (as on the web).
function keyOf(tpl: Pick<Template, 'name' | 'language'>) {
  return `${tpl.name}::${tpl.language}`
}
const selected = computed(() => templates.value.find((tpl) => keyOf(tpl) === selectedKey.value) ?? null)
const isLocation = computed(() => selected.value?.mediaHeaderFormat === 'LOCATION')
const canSend = computed(() => {
  if (!selected.value || sending.value) return false
  if (isLocation.value) return latitude.value !== '' && longitude.value !== ''
  return true
})

onMounted(async () => {
  try {
    const { templates: list } = await useStaffFetch<{ templates: Template[] }>('/api/whatsapp/templates')
    templates.value = list
    // As the web's SendWhatsAppModal: the patient's language first, then any
    // approved variant of it.
    const candidates = props.defaultTemplateName ? list.filter((tpl) => tpl.name === props.defaultTemplateName) : []
    const lang = props.patientPreferredLanguage ?? ''
    const match = candidates.find((tpl) => tpl.language === lang) ?? candidates.find((tpl) => tpl.language.split('_')[0] === lang) ?? candidates[0]
    if (match) choose(match)
  } catch (err: unknown) {
    loadError.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('Could not load the WhatsApp templates.', 'No se han podido cargar las plantillas de WhatsApp.')
  } finally {
    loading.value = false
  }
  // Attachments come from the patient's files, so a bare number has none.
  if (props.patientId) {
    const { data } = await supabase.from('patient_files').select('id, file_name').eq('patient_id', props.patientId).not('storage_path', 'is', null).order('created_at', { ascending: false })
    files.value = data ?? []
  }
})

function choose(tpl: Template) {
  selectedKey.value = keyOf(tpl)
  // {{1}} is the first name, the way the web fills it; the rest start empty.
  const guesses = [props.patientId ? (props.patientFirstName ?? '') : '']
  variables.value = Array.from({ length: tpl.variableCount }, (_, i) => guesses[i] ?? '')
  attachmentFileId.value = ''
  latitude.value = ''
  longitude.value = ''
  locationName.value = ''
  locationAddress.value = ''
  error.value = ''
}

async function send() {
  const tpl = selected.value
  if (!tpl || !canSend.value) return
  sending.value = true
  error.value = ''
  try {
    await useStaffFetch('/api/whatsapp/send', {
      method: 'POST',
      body: {
        patientId: props.patientId ?? undefined,
        phoneNumber: props.patientId ? undefined : (props.phoneNumber ?? undefined),
        templateName: tpl.name,
        templateLanguage: tpl.language,
        variables: variables.value,
        headerFormat: tpl.mediaHeaderFormat ?? undefined,
        attachmentFileId: isLocation.value ? undefined : attachmentFileId.value || undefined,
        location: isLocation.value
          ? { latitude: Number(latitude.value), longitude: Number(longitude.value), name: locationName.value, address: locationAddress.value }
          : undefined,
      },
    })
    emit('sent')
  } catch (err: unknown) {
    error.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('Could not send it.', 'No se ha podido enviar.')
  } finally {
    sending.value = false
  }
}

function slot(n: number) {
  return `{{${n}}}`
}

const inputCls = 'block w-full rounded-ctl border border-line-control bg-surface px-3 py-2.5 text-[15px] text-ink-900 focus:border-brand focus:outline-none'
</script>

<template>
  <!-- Lifted by the keyboard's height: the WebView does not resize for it
       (capacitor.config.ts, Keyboard.resize 'none'), so without this the
       variables and Send would sit under the keyboard. -->
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" :style="{ paddingBottom: keyboardHeight + 'px' }" data-cy="wa-template-sheet" @click.self="emit('close')">
    <div class="flex max-h-[88%] w-full flex-col rounded-t-[22px] bg-surface shadow-popover md:max-w-[520px] md:rounded-[18px]" role="dialog" aria-modal="true" :aria-label="t('Send a template', 'Enviar una plantilla')">
      <div class="shrink-0 px-4 pt-2.5">
        <div class="mx-auto mb-2 h-1 w-[38px] rounded-full bg-line-control md:hidden" />
        <div class="flex items-center justify-between gap-2 pb-2">
          <button v-if="selected" type="button" class="py-1 text-[14px] font-medium text-brand-text" data-cy="wa-template-back" @click="selectedKey = ''"><AppChevron dir="left" /> {{ t('Templates', 'Plantillas') }}</button>
          <p v-else class="text-[16px] font-semibold text-ink-900">{{ t('Send a template', 'Enviar una plantilla') }}</p>
          <button type="button" class="py-1 text-[14px] font-medium text-brand-text" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <div v-if="loading" class="space-y-2">
          <UiSkeleton v-for="i in 3" :key="i" class="h-14 w-full rounded-ctl" />
        </div>
        <p v-else-if="loadError" class="text-[13.5px] text-danger-text" data-cy="wa-template-error">{{ loadError }}</p>
        <p v-else-if="templates.length === 0" class="text-[13.5px] text-ink-muted">
          {{ t('This clinic has no approved WhatsApp templates yet.', 'Esta clínica aún no tiene plantillas de WhatsApp aprobadas.') }}
        </p>

        <!-- The list -->
        <ul v-else-if="!selected" class="divide-y divide-line-divider" data-cy="wa-template-list">
          <li v-for="tpl in templates" :key="keyOf(tpl)">
            <button type="button" class="block w-full py-3 text-left" data-cy="wa-template-option" @click="choose(tpl)">
              <span class="flex items-center gap-2">
                <span class="truncate text-[14.5px] font-medium text-ink-900">{{ tpl.name }}</span>
                <span class="shrink-0 rounded-pill bg-chip-bg px-1.5 py-px text-[11px] font-medium text-chip-text">{{ tpl.language }}</span>
              </span>
              <span class="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-muted2">{{ tpl.bodyText }}</span>
            </button>
          </li>
        </ul>

        <!-- The chosen one -->
        <div v-else class="space-y-3" data-cy="wa-template-form">
          <div>
            <p class="text-[14.5px] font-semibold text-ink-900">{{ selected.name }} <span class="text-[12px] font-medium text-ink-muted2">({{ selected.language }})</span></p>
            <p class="mt-1.5 whitespace-pre-wrap rounded-[10px] bg-surface-page px-3 py-2.5 text-[13.5px] leading-snug text-ink-700" data-cy="wa-template-body">{{ selected.bodyText }}</p>
          </div>

          <label v-for="(v, i) in variables" :key="i" class="block">
            <span class="mb-1 block text-[12.5px] font-medium text-ink-muted">{{ slot(i + 1) }}</span>
            <input v-model="variables[i]" type="text" :class="inputCls" data-cy="wa-template-variable" />
          </label>

          <template v-if="isLocation">
            <p class="text-[12.5px] font-medium text-ink-muted">{{ t('Location (required by the template)', 'Ubicación (la pide la plantilla)') }}</p>
            <div class="grid grid-cols-2 gap-2">
              <input v-model="latitude" type="number" step="any" inputmode="decimal" :placeholder="t('Latitude', 'Latitud')" :class="inputCls" />
              <input v-model="longitude" type="number" step="any" inputmode="decimal" :placeholder="t('Longitude', 'Longitud')" :class="inputCls" />
            </div>
            <input v-model="locationName" type="text" :placeholder="t('Place name', 'Nombre del lugar')" :class="inputCls" />
            <input v-model="locationAddress" type="text" :placeholder="t('Address', 'Dirección')" :class="inputCls" />
          </template>
          <label v-else-if="selected.mediaHeaderFormat" class="block">
            <span class="mb-1 block text-[12.5px] font-medium text-ink-muted">{{ t('Attachment', 'Adjunto') }} ({{ selected.mediaHeaderFormat.toLowerCase() }})</span>
            <select v-model="attachmentFileId" :class="inputCls">
              <option value="">{{ t('No attachment', 'Sin adjunto') }}</option>
              <option v-for="f in files" :key="f.id" :value="f.id">{{ f.file_name }}</option>
            </select>
          </label>
        </div>
      </div>

      <div v-if="selected" class="shrink-0 border-t border-line px-4 pt-3" style="padding-bottom: max(env(safe-area-inset-bottom), 0.75rem)">
        <p v-if="error" class="mb-2 text-[12.5px] text-danger-text" data-cy="wa-template-send-error">{{ error }}</p>
        <UiBtn variant="primary" class="h-11 w-full" :disabled="!canSend" data-cy="wa-template-send" @click="send">
          {{ sending ? t('Sending…', 'Enviando…') : t('Send', 'Enviar') }}
        </UiBtn>
      </div>
      <div v-else class="shrink-0" style="height: max(env(safe-area-inset-bottom), 0.75rem)" />
    </div>
  </div>
</template>
