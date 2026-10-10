<script setup lang="ts">
import { EMAIL_MERGE_FIELDS, say } from '~/utils/automationCatalog'
import { FIELD, HINT, LABEL, NOTE } from '~/utils/automationUi'
import { automationEmailHtml, emptyBodyPlaceholderHtml, DEFAULT_BOOKING_BUTTON_TEXT } from '~/utils/automationEmail'

// An email step: subject and body, with the patient's details as merge fields
// ({{first_name}} and the rest, resolved per recipient when it is sent).
// Optional blocks -- the clinic's logo on top, a button to the online booking
// page under the message -- and a live preview built with the same envelope
// the send uses (utils/automationEmail.ts), filled with an example patient.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)

// A lead automation can also merge in what the lead answered on their form,
// one chip per question ({{answer_…}}), shortened so a long question does not
// push the toolbar off the side.
const short = (s: string) => (s.length > 40 ? s.slice(0, 39).trimEnd() + '…' : s)
const store = useAccountStore()
const supabase = useSupabaseClient()
const logoUrl = computed(() => {
  const path = store.currentClinic?.logo_storage_path ?? store.clinics.find((c) => c.logo_storage_path)?.logo_storage_path
  return path ? supabase.storage.from('clinic-logos').getPublicUrl(path).data.publicUrl : null
})
const bookingUrl = computed(() => (store.accountSlug && import.meta.client ? `${window.location.origin}/book/${store.accountSlug}` : null))
const clinicName = computed(() => store.currentClinic?.name ?? '')

// The example the preview is filled with; the real values arrive per patient.
const SAMPLE: Record<string, string> = {
  first_name: 'Lucía',
  last_name: 'García',
  email: 'lucia@ejemplo.com',
  next_appointment: 'jueves 16 de octubre, 10:00',
  appointment_date: 'jueves 16 de octubre',
  appointment_time: '10:00',
  google_review_link: 'https://g.page/r/ejemplo/review',
  waitlist_claim_link: 'https://app.quiroflow.com/w/ejemplo',
  waitlist_slot_datetime: 'viernes 17, 18:30',
}
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sample = (key: string) => {
  if (key === 'clinic_name') return clinicName.value
  if (key === 'clinic_phone') return '+34 600 000 000'
  if (key === 'clinic_address') return store.currentClinic?.address ?? ''
  return SAMPLE[key] ?? `[${key}]`
}
const previewSubject = computed(() => (config.value.subject ?? '').replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => sample(k)))
const previewHtml = computed(() => {
  const body = (config.value.body ?? '').replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => esc(sample(k)))
  const html = automationEmailHtml(body || emptyBodyPlaceholderHtml(t('Your message appears here.', 'Aquí aparece tu mensaje.')), {
    clinicName: clinicName.value,
    // A marketing email carries the unsubscribe footer; shown so it is no surprise.
    unsubscribe: b.draft.value.rule.is_marketing ? { page: '#', oneClick: '#' } : null,
    logoUrl: config.value.include_logo ? logoUrl.value : null,
    button: config.value.booking_button && bookingUrl.value ? { text: config.value.booking_button_text ?? '', url: bookingUrl.value } : null,
  })
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0">${html}</body></html>`
})
const fields = computed(() => [
  ...EMAIL_MERGE_FIELDS.map((f) => ({ key: f.value, label: say(t, f.label) })),
  ...(b.isLead.value ? b.leadQuestions.value.map((q) => ({ key: q.key, label: short(q.question) })) : []),
])
</script>

<template>
  <div class="flex flex-col gap-4">
    <label :class="LABEL">
      {{ t('Subject', 'Asunto') }}
      <input :class="FIELD" :value="config.subject ?? ''" :placeholder="t('Subject — {{first_name}} works here too', 'Asunto — {{first_name}} también funciona aquí')" data-test="email-subject" @input="set({ subject: ($event.target as HTMLInputElement).value })" />
    </label>
    <div :class="LABEL">
      {{ t('Message', 'Mensaje') }}
      <AutomationsRichTextEditor :key="stepId" :model-value="config.body ?? ''" :variables="fields" @update:model-value="set({ body: $event })" />
    </div>
    <p :class="HINT">{{ t('Click a field to insert it where the cursor is. It is filled in for each patient when the email goes out.', 'Pulsa un campo para insertarlo donde está el cursor. Se rellena con los datos de cada paciente al enviar.') }}</p>

    <div class="flex flex-col gap-2.5 rounded-ctl border border-line px-3 py-2.5" data-test="email-blocks">
      <label class="flex items-center justify-between gap-3 text-[13px] text-ink-700">
        <span>{{ t("Clinic logo on top", 'Logo de la clínica arriba') }}<span v-if="!logoUrl" class="block text-[11.5px] text-ink-muted">{{ t('Upload one in Settings > Clinics.', 'Súbelo en Ajustes > Clínicas.') }}</span></span>
        <input type="checkbox" :checked="!!config.include_logo" :disabled="!logoUrl" data-test="email-include-logo" @change="set({ include_logo: ($event.target as HTMLInputElement).checked })" />
      </label>
      <label class="flex items-center justify-between gap-3 text-[13px] text-ink-700">
        <span>{{ t('Button to book online', 'Botón para reservar online') }}</span>
        <input type="checkbox" :checked="!!config.booking_button" data-test="email-booking-button" @change="set({ booking_button: ($event.target as HTMLInputElement).checked })" />
      </label>
      <input v-if="config.booking_button" :class="FIELD" :value="config.booking_button_text ?? ''" :placeholder="DEFAULT_BOOKING_BUTTON_TEXT" data-test="email-booking-button-text" @input="set({ booking_button_text: ($event.target as HTMLInputElement).value })" />
    </div>

    <div :class="LABEL">
      {{ t('Preview', 'Vista previa') }}
      <div class="overflow-hidden rounded-ctl border border-line" data-test="email-preview">
        <div class="space-y-0.5 border-b border-line bg-surface-subtle px-3 py-2 text-[12px] font-normal text-ink-700">
          <p><span class="text-ink-muted">{{ t('From', 'De') }}:</span> {{ clinicName }}</p>
          <p class="truncate"><span class="text-ink-muted">{{ t('Subject', 'Asunto') }}:</span> <span data-test="email-preview-subject">{{ previewSubject || '—' }}</span></p>
        </div>
        <iframe :srcdoc="previewHtml" sandbox="allow-popups" class="h-[420px] w-full bg-surface-subtle" :title="t('Email preview', 'Vista previa del email')" />
      </div>
      <p :class="HINT">{{ t('Filled in with an example patient; each patient gets their own details.', 'Rellenada con un paciente de ejemplo; cada paciente recibe sus propios datos.') }}</p>
    </div>
    <p v-if="b.draft.value.rule.is_marketing" :class="NOTE">{{ t('This automation is marketing: only patients who accepted marketing email receive it.', 'Esta automatización es comercial: solo la reciben los pacientes que aceptaron email comercial.') }}</p>
  </div>
</template>
