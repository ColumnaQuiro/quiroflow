<script setup lang="ts">
import { messageStepsInOrder } from '~/utils/automationTree'
import { FIELD } from '~/utils/automationUi'
import { serverMessage } from '~/utils/serverMessage'

// "Send a test to me": the message steps on screen -- saved or not -- sent
// to the signed-in team member instead of a patient (/api/automations/send-test,
// unchanged from Campaigns). Waits and conditions are skipped; every
// WhatsApp, email and webhook in the flow goes out once, in order.

const emit = defineEmits<{ close: [] }>()
const b = useBuilder()
const t = useT()

const steps = computed(() => messageStepsInOrder(b.draft.value.steps))
const hasWhatsApp = computed(() => steps.value.some((s) => s.action_type === 'whatsapp_template'))
// A test send is not a real patient, so document links cannot be generated.
const hasDoc = computed(() => steps.value.some((s) => s.action_type === 'whatsapp_template' && (s.config.doc_template_ids ?? []).some(Boolean)))
const number = ref('')
const busy = ref(false)
const result = ref('')
const failed = ref(false)

async function send() {
  if (steps.value.length === 0) {
    result.value = t('There is nothing to send: add a WhatsApp, email or webhook step.', 'No hay nada que enviar: añade un paso de WhatsApp, email o webhook.')
    failed.value = true
    return
  }
  if (hasWhatsApp.value && !number.value.trim()) {
    result.value = t('Enter a WhatsApp number to test with.', 'Introduce un número de WhatsApp para probar.')
    failed.value = true
    return
  }
  busy.value = true
  result.value = ''
  try {
    const res = await useStaffFetch<{ email: string | null; whatsappNumber: string | null }>('/api/automations/send-test', {
      method: 'POST',
      body: { actions: steps.value.map((s) => ({ action_type: s.action_type, config: s.config })), whatsappNumber: hasWhatsApp.value ? number.value : undefined },
    })
    const parts: string[] = []
    if (res.whatsappNumber) parts.push(`${t('WhatsApp to', 'WhatsApp a')} +${res.whatsappNumber}`)
    if (res.email) parts.push(`${t('email to', 'email a')} ${res.email}`)
    result.value = parts.length ? `${t('Sent', 'Enviado')}: ${parts.join(', ')}` : t('Nothing to send.', 'Nada que enviar.')
    failed.value = false
  } catch (e) {
    // The server says exactly why -- no email on file, an unverified sending
    // domain, a consent gate. A flat "failed" left nobody able to fix it.
    result.value = serverMessage(e) ?? t('Failed to send the test.', 'No se ha podido enviar la prueba.')
    failed.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiConfirmDialog
    :title="t('Send a test to me', 'Enviar prueba a mí')"
    :confirm-label="busy ? t('Sending…', 'Enviando…') : t('Send', 'Enviar')"
    :cancel-label="t('Close', 'Cerrar')"
    :busy="busy"
    @confirm="send"
    @cancel="emit('close')"
  >
    <p class="text-[14px] leading-relaxed text-ink-500">
      {{ t(`The ${steps.length} message step(s) on screen, saved or not, to you. Waits and conditions are skipped.`, `Los ${steps.length} pasos de mensaje que ves, guardados o no, a ti. Las esperas y condiciones se saltan.`) }}
    </p>
    <label v-if="hasWhatsApp" class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('Your WhatsApp number', 'Tu número de WhatsApp') }}
      <input v-model="number" :class="FIELD" placeholder="+34600000000" data-test="test-whatsapp-number" />
    </label>
    <p v-if="hasDoc" class="text-[12.5px] text-ink-muted">{{ t('A test is not a real patient, so document links will not work -- launch it for a real patient to check those.', 'Una prueba no es un paciente real, así que los enlaces a documentos no funcionan -- lánzala para un paciente real para comprobarlos.') }}</p>
    <p v-if="result" class="text-[13px]" :class="failed ? 'text-danger-text' : 'text-success-text'" data-test="test-result">{{ result }}</p>
  </UiConfirmDialog>
</template>
