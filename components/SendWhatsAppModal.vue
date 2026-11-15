<script setup lang="ts">
import type { Tables } from '~/types/database.types'

interface Template {
  name: string
  language: string
  category: string
  bodyText: string
  variableCount: number
  mediaHeaderFormat: 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'LOCATION' | null
  /** The file the template was created with in QuiroFlow, when it was. */
  headerMedia?: { filename: string }
}

// The attachment choice that means "the template's own file" rather than one
// of the patient's -- the guide a template was made to send.
const TEMPLATE_FILE = 'template'

const props = withDefaults(
  defineProps<{
    /** Either a patient, or (from the Inbox) a number no patient has yet. */
    patientId?: string
    phoneNumber?: string
    /** Or a lead, from their thread in the Growth Inbox. */
    leadId?: string
    patientFirstName?: string
    patientPreferredLanguage?: string
    appointmentId?: string
    defaultTemplateName?: string
    autofill?: Record<string, string>
    allowTemplateOverride?: boolean
    /** Replaces the dialog's title, for a send with one purpose ("Send the app"). */
    title?: string
    /** Said instead of "set a default in Settings" when a fixed template does not exist. */
    missingTemplateMessage?: string
    /** A person writing to this one patient (their record, the Inbox), not a
     *  recall or a list: lets it reach someone marked "do not contact". */
    personal?: boolean
  }>(),
  { allowTemplateOverride: true },
)

const emit = defineEmits<{ close: []; sent: [] }>()

const supabase = useSupabaseClient()
const t = useT()

// A modal dialog: focus stays inside it, Escape closes it, and focus goes
// back to whatever opened it (useFocusTrap).
const dialogPanel = ref<HTMLElement | null>(null)
const dialogTitleId = useId()
useFocusTrap(dialogPanel, () => emit('close'))
const accountStore = useAccountStore()
const templates = ref<Template[]>([])
const templatesError = ref('')
const loadingTemplates = ref(true)
const selectedTemplateKey = ref('')
const variables = ref<string[]>([])
const files = ref<Tables<'patient_files'>[]>([])
const attachmentFileId = ref('')
// There's no stored clinic geocoding anywhere in the schema, so latitude/
// longitude are always typed in by hand -- name/address are prefilled from
// the clinic as an editable example, not a real coordinate source.
const locationLatitude = ref('')
const locationLongitude = ref('')
const locationName = ref('')
const locationAddress = ref('')
const sending = ref(false)
const error = ref('')

// Template name alone isn't unique -- the same name can have multiple
// approved language variants (e.g. "appointment_reminder" in es/en/fr) --
// so options are keyed by name+language, not name alone.
function templateKey(t: Pick<Template, 'name' | 'language'>) {
  return `${t.name}::${t.language}`
}

const selectedTemplate = computed(() => templates.value.find((t) => templateKey(t) === selectedTemplateKey.value) ?? null)

onMounted(async () => {
  try {
    const { templates: list } = await useStaffFetch<{ templates: Template[] }>('/api/whatsapp/templates')
    templates.value = list
    const candidates = list.filter((t) => t.name === props.defaultTemplateName)
    // Prefer the variant matching the patient's own communication language,
    // falling back to whatever approved variant exists otherwise.
    const defaultMatch =
      candidates.find((t) => t.language === props.patientPreferredLanguage) ??
      candidates.find((t) => t.language.split('_')[0] === props.patientPreferredLanguage) ??
      candidates[0]
    if (defaultMatch) selectTemplate(templateKey(defaultMatch))
  } catch (err: any) {
    templatesError.value = withServerDetail(t("Couldn't load the WhatsApp templates. Close this and try again.", 'No se han podido cargar las plantillas de WhatsApp. Cierra y vuelve a intentarlo.'), err, t('Details:', 'Detalle:'))
  } finally {
    loadingTemplates.value = false
  }

  // Attachments come from the patient's files, so a bare number has none.
  if (props.patientId) {
    const { data } = await supabase.from('patient_files').select('*').eq('patient_id', props.patientId).order('created_at', { ascending: false })
    files.value = data ?? []
  }
})

function slot(n: number) {
  return `{{${n}}}`
}

// What {{1}}, {{2}}... are prefilled with: the patient's first name, then
// whatever the caller knows (an appointment's date and time, say). The
// picker's previews use the same values.
const guesses = computed(() => [props.patientFirstName ?? '', ...(props.autofill ? Object.values(props.autofill) : [])])

function selectTemplate(key: string) {
  selectedTemplateKey.value = key
  const t = templates.value.find((tpl) => templateKey(tpl) === key)
  const count = t?.variableCount ?? 0
  variables.value = Array.from({ length: count }, (_, i) => guesses.value[i] ?? '')
  attachmentFileId.value = t?.headerMedia ? TEMPLATE_FILE : ''
  locationLatitude.value = ''
  locationLongitude.value = ''
  locationName.value = accountStore.currentClinic?.name ?? ''
  locationAddress.value = accountStore.currentClinic?.address ?? ''
}

const isLocationTemplate = computed(() => selectedTemplate.value?.mediaHeaderFormat === 'LOCATION')
const canSend = computed(() => {
  if (!selectedTemplate.value) return false
  // WhatsApp refuses an empty {{n}} or a media header with nothing in it
  // ("(#131008) Required parameter is missing"), so neither can be sent.
  if (variables.value.some((v) => !v.trim())) return false
  if (isLocationTemplate.value) return locationLatitude.value !== '' && locationLongitude.value !== ''
  if (selectedTemplate.value.mediaHeaderFormat) return attachmentFileId.value !== ''
  return true
})

// The template's header, named: Meta's own word ('IMAGE') reached a Spanish
// screen as "Adjuntar image".
const headerFileName = computed(() => {
  const format = selectedTemplate.value?.mediaHeaderFormat
  if (format === 'IMAGE') return t('an image', 'una imagen')
  if (format === 'VIDEO') return t('a video', 'un vídeo')
  return t('a document', 'un documento')
})

// Why Send is greyed out, said under it rather than left to be guessed.
const whyCannotSend = computed(() => {
  if (!selectedTemplate.value || canSend.value || sending.value) return ''
  if (variables.value.some((v) => !v.trim())) return t('Fill in every field to send it.', 'Rellena todos los campos para enviarla.')
  if (isLocationTemplate.value) return t('Add the latitude and longitude to send it.', 'Añade la latitud y la longitud para enviarla.')
  if (files.value.length === 0 && !selectedTemplate.value.headerMedia) {
    return props.patientId
      ? t("This template needs a file from the patient's record, and they have none yet.", 'Esta plantilla necesita un archivo de la ficha del paciente, y aún no tiene ninguno.')
      : t('This template needs a file from a patient record. Link this number to a patient first.', 'Esta plantilla necesita un archivo de una ficha. Vincula antes este número a un paciente.')
  }
  return t('Choose the file to attach to send it.', 'Elige el archivo que adjuntar para enviarla.')
})

async function send() {
  error.value = ''
  if (!selectedTemplate.value || !canSend.value) return
  sending.value = true
  try {
    await useStaffFetch('/api/whatsapp/send', {
      method: 'POST',
      body: {
        patientId: props.patientId,
        personal: props.personal || undefined,
        phoneNumber: props.patientId || props.leadId ? undefined : props.phoneNumber,
        leadId: props.patientId ? undefined : props.leadId,
        templateName: selectedTemplate.value.name,
        templateLanguage: selectedTemplate.value.language,
        variables: variables.value,
        headerFormat: selectedTemplate.value.mediaHeaderFormat ?? undefined,
        attachmentFileId: isLocationTemplate.value || attachmentFileId.value === TEMPLATE_FILE ? undefined : attachmentFileId.value || undefined,
        templateMedia: attachmentFileId.value === TEMPLATE_FILE || undefined,
        location: isLocationTemplate.value
          ? {
              latitude: Number(locationLatitude.value),
              longitude: Number(locationLongitude.value),
              name: locationName.value,
              address: locationAddress.value,
            }
          : undefined,
        appointmentId: props.appointmentId,
      },
    })
    emit('sent')
    emit('close')
  } catch (err: any) {
    error.value = withServerDetail(t("Couldn't send the message.", 'No se ha podido enviar el mensaje.'), err, t('Details:', 'Detalle:'))
  } finally {
    sending.value = false
  }
}

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4" @click.self="emit('close')">
    <div ref="dialogPanel" role="dialog" aria-modal="true" :aria-labelledby="dialogTitleId" class="max-h-full w-full overflow-y-auto max-w-lg rounded-card border border-line bg-surface p-5 shadow-popover">
      <h3 :id="dialogTitleId" class="text-[14px] font-semibold text-ink-900">{{ title ?? t('Send WhatsApp message', 'Enviar mensaje de WhatsApp') }}</h3>

      <div v-if="loadingTemplates" class="mt-3 text-[13px] text-ink-faint">{{ t('Loading templates…', 'Cargando plantillas…') }}</div>
      <p v-else-if="templatesError" class="mt-3 text-[13px] text-danger-text">{{ templatesError }}</p>
      <p v-else-if="!allowTemplateOverride && !selectedTemplate" class="mt-3 text-[13px] text-danger-text" data-cy="whatsapp-template-missing">
        {{ missingTemplateMessage ?? t('No default template is set. Choose one in Settings → WhatsApp.', 'No hay ninguna plantilla predeterminada. Elige una en Ajustes → WhatsApp.') }}
      </p>
      <template v-else>
        <WhatsAppTemplatePicker
          v-if="allowTemplateOverride"
          class="mt-3"
          :model-value="selectedTemplateKey"
          :templates="templates"
          :preferred-language="patientPreferredLanguage"
          :fill="guesses"
          @update:model-value="selectTemplate"
        />

        <template v-if="selectedTemplate">
          <p class="mt-3 whitespace-pre-wrap rounded-ctl bg-surface-subtle p-2.5 text-xs text-ink-muted2">{{ selectedTemplate.bodyText }}</p>

          <div v-if="variables.length > 0" class="mt-3 space-y-2">
            <div v-for="(v, i) in variables" :key="i">
              <label :for="`${fieldId}-variable-${i}`" class="block text-xs font-medium text-ink-muted">{{ t(`Text for ${slot(i + 1)}`, `Texto para ${slot(i + 1)}`) }}</label>
              <input :id="`${fieldId}-variable-${i}`"
                v-model="variables[i]"
                type="text"
                class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>
          </div>

          <div v-if="isLocationTemplate" class="mt-3 space-y-2">
            <label class="block text-xs font-medium text-ink-muted">{{ t('Location (the template requires one)', 'Ubicación (la plantilla la pide)') }}</label>
            <div class="grid grid-cols-2 gap-2">
              <input
                v-model="locationLatitude"
                type="number"
                step="any"
                :placeholder="t('Latitude, e.g. 40.4168', 'Latitud, p. ej. 40.4168')"
                class="rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
              <input
                v-model="locationLongitude"
                type="number"
                step="any"
                :placeholder="t('Longitude, e.g. -3.7038', 'Longitud, p. ej. -3.7038')"
                class="rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <input
              v-model="locationName"
              type="text"
              :placeholder="t('Place name, e.g. Clínica Demo', 'Nombre del lugar, p. ej. Clínica Demo')"
              class="w-full rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
            />
            <input
              v-model="locationAddress"
              type="text"
              :placeholder="t('Address, e.g. Calle Mayor 12, Madrid', 'Dirección, p. ej. Calle Mayor 12, Madrid')"
              class="w-full rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
            />
          </div>
          <div v-else-if="selectedTemplate.mediaHeaderFormat" class="mt-3">
            <label :for="`${fieldId}-attachmentFileId`" class="block text-xs font-medium text-ink-muted">{{ t(`Attach ${headerFileName} (the template requires it)`, `Adjuntar ${headerFileName} (la plantilla lo pide)`) }}</label>
            <select :id="`${fieldId}-attachmentFileId`" v-model="attachmentFileId" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-1.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
              <option value="">{{ t('No attachment', 'Sin adjunto') }}</option>
              <option v-if="selectedTemplate.headerMedia" :value="TEMPLATE_FILE">{{ t(`The template's file: ${selectedTemplate.headerMedia.filename}`, `El archivo de la plantilla: ${selectedTemplate.headerMedia.filename}`) }}</option>
              <option v-for="f in files" :key="f.id" :value="f.id">{{ f.file_name }}</option>
            </select>
          </div>
        </template>
      </template>

      <p v-if="error" class="mt-2 text-[13px] text-danger-text">{{ error }}</p>
      <p v-else-if="whyCannotSend" class="mt-2 text-[12.5px] text-ink-muted" data-cy="whatsapp-send-why-disabled">{{ whyCannotSend }}</p>

      <div class="mt-4 flex justify-end gap-2">
        <UiBtn type="button" variant="secondary" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn type="button" variant="primary" :disabled="sending || !canSend" @click="send">
          {{ sending ? t('Sending…', 'Enviando…') : t('Send', 'Enviar') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>
