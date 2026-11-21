<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'
import { clampReminderDays, MAX_REMINDER_DAYS, REMINDER_SEND_HOUR } from '~/utils/appointmentReminderDue'

// Settings > Messages (was Communication > General, which still redirects
// here): what patients are sent on their own around each appointment.
//
// It also held two settings that were never about these messages, under
// "Details messages use": the default phone country, now in Settings > New
// Patient Fields beside the phone field it fills in, and the Google review
// link, now Settings > Reviews. The alerts to staff about a new booking or
// lead are in Settings > Team alerts.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const confirmationEnabled = ref(true)
const confirmationChannels = ref<string[]>(['whatsapp'])
const emailConfirmationSubject = ref('')
const emailConfirmationBody = ref('')

const reminderEnabled = ref(true)
const reminderChannels = ref<string[]>(['whatsapp'])
// Days before the visit; the reminders go out together at 10:00 clinic time
// that day (utils/appointmentReminderDue.ts).
const reminderDaysBefore = ref(1)
const REMINDER_DAY_CHOICES = Array.from({ length: MAX_REMINDER_DAYS }, (_, i) => i + 1)
const reminderSendTime = `${String(REMINDER_SEND_HOUR).padStart(2, '0')}:00`
function reminderDaysLabel(days: number) {
  return days === 1 ? t('The day before', 'El día antes') : t(`${days} days before`, `${days} días antes`)
}
const emailReminderSubject = ref('')
const emailReminderBody = ref('')

const { showToast } = useToast()
const loading = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select(
      'appointment_confirmation_enabled, appointment_confirmation_channels, email_confirmation_subject, email_confirmation_body, appointment_reminder_enabled, appointment_reminder_channels, appointment_reminder_days_before, email_reminder_subject, email_reminder_body',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  confirmationEnabled.value = data?.appointment_confirmation_enabled ?? true
  confirmationChannels.value = data?.appointment_confirmation_channels ?? ['whatsapp']
  emailConfirmationSubject.value = data?.email_confirmation_subject ?? ''
  emailConfirmationBody.value = data?.email_confirmation_body ?? ''
  reminderEnabled.value = data?.appointment_reminder_enabled ?? true
  reminderChannels.value = data?.appointment_reminder_channels ?? ['whatsapp']
  reminderDaysBefore.value = clampReminderDays(data?.appointment_reminder_days_before)
  emailReminderSubject.value = data?.email_reminder_subject ?? ''
  emailReminderBody.value = data?.email_reminder_body ?? ''
  loading.value = false
}
onMounted(load)

// The editor's HTML with nothing typed in it ("<p><br></p>") is not empty
// as a string, and the sender would send it.
function hasText(html: string) {
  return html.replace(/<[^>]*>|&nbsp;/g, '').trim() !== ''
}

async function save() {
  // An email channel with no subject or body sends nothing
  // (server/utils/appointmentNotifications.ts needs both), while the booking
  // page tells the patient the details are on their way to their inbox.
  for (const [on, channels, subject, body, name] of [
    [confirmationEnabled.value, confirmationChannels.value, emailConfirmationSubject.value, emailConfirmationBody.value, t('confirmation', 'confirmación')],
    [reminderEnabled.value, reminderChannels.value, emailReminderSubject.value, emailReminderBody.value, t('reminder', 'recordatorio')],
  ] as const) {
    if (on && channels.includes('email') && (!subject.trim() || !hasText(body))) {
      showToast(t(`The ${name} email needs a subject and a message, or untick Email.`, `El correo de ${name} necesita asunto y mensaje, o desmarca Correo.`), 'error')
      return
    }
  }
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    appointment_confirmation_enabled: confirmationEnabled.value,
    appointment_confirmation_channels: confirmationChannels.value,
    email_confirmation_subject: emailConfirmationSubject.value.trim() || null,
    email_confirmation_body: emailConfirmationBody.value.trim() || null,
    appointment_reminder_enabled: reminderEnabled.value,
    appointment_reminder_channels: reminderChannels.value,
    appointment_reminder_days_before: clampReminderDays(reminderDaysBefore.value),
    email_reminder_subject: emailReminderSubject.value.trim() || null,
    email_reminder_body: emailReminderBody.value.trim() || null,
  }
  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    showToast(updateError.message, 'error')
    return
  }
  showToast(t('Saved', 'Guardado'))
}

// --- channels and the email preview ---
type Channel = 'whatsapp' | 'email' | 'push'
const CHANNELS = computed<{ key: Channel; label: string }[]>(() => [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: t('Email', 'Correo') },
  { key: 'push', label: t('Patient app', 'App del paciente') },
])
function toggled(list: string[], key: Channel) {
  return list.includes(key) ? list.filter((c) => c !== key) : [...list, key]
}

// Every field appointmentNotifications.mergeText fills in -- the old page
// listed four of the eight.
const MERGE_FIELDS = computed(() => [
  { key: 'first_name', label: t('First name', 'Nombre') },
  { key: 'last_name', label: t('Last name', 'Apellidos') },
  { key: 'next_appointment', label: t('Appointment date', 'Fecha de la cita') },
  { key: 'appointment_type_name', label: t('Appointment type', 'Tipo de cita') },
  { key: 'practitioner_name', label: t('Practitioner', 'Profesional') },
  { key: 'clinic_name', label: t('Clinic name', 'Nombre de la clínica') },
  { key: 'clinic_address', label: t('Clinic address', 'Dirección de la clínica') },
  { key: 'clinic_phone', label: t('Clinic phone', 'Teléfono de la clínica') },
])

// A sample of what a patient receives. Plain text on purpose: the body is
// the editor's HTML, and the preview only needs its words.
const SAMPLE: Record<string, string> = {
  first_name: 'Lucía',
  last_name: 'Martín',
  next_appointment: '9 de octubre de 2026, 17:30',
  appointment_type_name: 'Ajuste',
  practitioner_name: 'Laura G.',
  clinic_name: store.accountName || 'Clínica',
  clinic_address: 'Calle Colón 12',
  clinic_phone: '+34 960 000 000',
}
function sample(text: string) {
  if (!import.meta.client) return text
  // One line per paragraph: textContent alone runs the editor's blocks
  // (a <div> per Enter, or <p>) together.
  const doc = new DOMParser().parseFromString(text, 'text/html')
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  doc.querySelectorAll('div, p, li, h1, h2, h3').forEach((b) => b.before('\n'))
  const plain = (doc.body.textContent ?? '').replace(/^\n+/, '')
  return plain.replace(/\{\{(\w+)\}\}/g, (_, key: string) => SAMPLE[key] ?? '')
}

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Messages', 'Mensajes')">
      <UiBtn variant="primary" data-cy="messages-save" :disabled="saving || loading" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="messages-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('What patients are sent on their own around each appointment.', 'Lo que se envía solo a los pacientes en torno a cada cita.') }}
          </p>

          <template v-if="loading">
            <UiSkeleton v-for="i in 3" :key="i" class="h-40 w-full rounded-card" />
          </template>
          <template v-else>
            <section
              v-for="m in [
                {
                  key: 'confirmation',
                  title: t('Appointment confirmation', 'Confirmación de cita'),
                  sub: t('Sent right after an appointment is booked: at the desk, online, in the app or through the API.', 'Se envía justo después de reservar una cita: en recepción, online, en la app o por la API.'),
                },
                { key: 'reminder', title: t('Appointment reminder', 'Recordatorio de cita'), sub: t('Sent automatically before the visit.', 'Se envía automáticamente antes de la visita.') },
              ]"
              :key="m.key"
              :aria-labelledby="`h-${m.key}`"
              :data-cy="`messages-${m.key}`"
              class="overflow-hidden rounded-card border border-line bg-surface"
            >
              <div class="flex items-start gap-4 px-[18px] pb-3.5 pt-4">
                <div class="flex-1">
                  <h2 :id="`h-${m.key}`" class="text-[16px] font-bold text-ink-900">{{ m.title }}</h2>
                  <p class="mt-1 text-[13px] leading-snug text-ink-muted">{{ m.sub }}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  data-cy="messages-enabled"
                  :aria-checked="m.key === 'confirmation' ? confirmationEnabled : reminderEnabled"
                  :aria-labelledby="`h-${m.key}`"
                  class="relative h-[26px] w-11 shrink-0 rounded-full"
                  :class="(m.key === 'confirmation' ? confirmationEnabled : reminderEnabled) ? 'bg-brand' : 'bg-toggle-off'"
                  @click="m.key === 'confirmation' ? (confirmationEnabled = !confirmationEnabled) : (reminderEnabled = !reminderEnabled)"
                >
                  <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card left-[3px] transition-transform" :class="(m.key === 'confirmation' ? confirmationEnabled : reminderEnabled) ? 'translate-x-[18px]' : 'translate-x-0'" />
                </button>
              </div>

              <template v-if="m.key === 'confirmation' ? confirmationEnabled : reminderEnabled">
                <div v-if="m.key === 'reminder'" class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                  <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                    <label for="reminder-days" class="text-[14.5px] font-bold text-ink-900">{{ t('When', 'Cuándo') }}</label>
                    <span class="text-[13px] text-ink-500">{{ t(`A day's reminders all go out together, at ${reminderSendTime} clinic time. A patient's record can set their own.`, `Los recordatorios de un día salen todos juntos, a las ${reminderSendTime} (hora de la clínica). En la ficha de un paciente se puede fijar otra antelación.`) }}</span>
                  </div>
                  <label class="flex items-center gap-2 text-[14px] text-ink-500">
                    <select id="reminder-days" v-model.number="reminderDaysBefore" data-cy="reminder-days" :class="inputClass">
                      <option v-for="d in REMINDER_DAY_CHOICES" :key="d" :value="d">{{ reminderDaysLabel(d) }}</option>
                    </select>
                    {{ t(`at ${reminderSendTime}`, `a las ${reminderSendTime}`) }}
                  </label>
                </div>

                <div class="flex flex-col gap-2.5 border-t border-line-row px-[18px] py-3.5">
                  <span :id="`send-by-${m.key}`" class="text-[12.5px] font-semibold text-ink-500">{{ t('Send by', 'Enviar por') }}</span>
                  <div role="group" :aria-labelledby="`send-by-${m.key}`" class="flex flex-wrap gap-2">
                    <button
                      v-for="c in CHANNELS"
                      :key="c.key"
                      type="button"
                      :data-cy="`channel-${c.key}`"
                      :aria-pressed="(m.key === 'confirmation' ? confirmationChannels : reminderChannels).includes(c.key)"
                      class="inline-flex h-10 touch:h-11 items-center gap-2 rounded-[9px] border px-3.5 text-[13.5px]"
                      :class="(m.key === 'confirmation' ? confirmationChannels : reminderChannels).includes(c.key) ? 'border-[1.5px] border-brand bg-brand-tint font-semibold text-ink-900' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
                      @click="m.key === 'confirmation' ? (confirmationChannels = toggled(confirmationChannels, c.key)) : (reminderChannels = toggled(reminderChannels, c.key))"
                    >
                      {{ c.label }}
                    </button>
                  </div>
                  <span class="text-[12.5px] leading-snug text-ink-muted">
                    {{ t('The app only reaches patients who have it, so it adds to WhatsApp and email rather than replacing them. WhatsApp templates are chosen in', 'La app solo llega a quien la tiene, así que se suma a WhatsApp y al correo en lugar de sustituirlos. Las plantillas de WhatsApp se eligen en') }}
                    <NuxtLink to="/settings/whatsapp" class="font-semibold text-brand-text hover:underline">WhatsApp</NuxtLink>.
                  </span>
                </div>

                <!-- The email, beside what a patient receives -->
                <div v-if="(m.key === 'confirmation' ? confirmationChannels : reminderChannels).includes('email')" class="flex flex-col gap-5 border-t border-line-row px-[18px] pb-[18px] pt-3.5 md:flex-row">
                  <div class="flex min-w-0 flex-1 flex-col gap-2.5">
                    <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                      {{ t('Email subject', 'Asunto del correo') }}
                      <input
                        v-if="m.key === 'confirmation'"
                        v-model="emailConfirmationSubject"
                        type="text"
                        data-cy="email-subject"
                        :placeholder="t('E.g. Your appointment is confirmed', 'Ej. Tu cita está confirmada')"
                        :class="[inputClass, 'w-full font-normal']"
                      />
                      <input v-else v-model="emailReminderSubject" type="text" data-cy="email-subject" :placeholder="t('E.g. See you tomorrow', 'Ej. Te esperamos mañana')" :class="[inputClass, 'w-full font-normal']" />
                    </label>
                    <div class="flex flex-col gap-1.5">
                      <span class="text-[13px] font-semibold text-ink-700">{{ t('Email message', 'Mensaje del correo') }}</span>
                      <AutomationsRichTextEditor v-if="m.key === 'confirmation'" v-model="emailConfirmationBody" :variables="MERGE_FIELDS" />
                      <AutomationsRichTextEditor v-else v-model="emailReminderBody" :variables="MERGE_FIELDS" />
                    </div>
                  </div>
                  <figure class="flex w-full shrink-0 flex-col gap-2 md:w-[300px]" data-cy="email-preview">
                    <figcaption class="text-[12.5px] font-semibold text-ink-500">{{ t('What Lucía receives', 'Lo que recibe Lucía') }}</figcaption>
                    <div class="flex flex-col gap-2 rounded-ctl border border-line bg-surface-subtle p-3.5 text-[13px] leading-relaxed text-ink-700">
                      <strong class="text-[13.5px] text-ink-900">{{ sample(m.key === 'confirmation' ? emailConfirmationSubject : emailReminderSubject) || t('(no subject)', '(sin asunto)') }}</strong>
                      <span class="whitespace-pre-line">{{ sample(m.key === 'confirmation' ? emailConfirmationBody : emailReminderBody) || t('(empty message)', '(mensaje vacío)') }}</span>
                    </div>
                  </figure>
                </div>
              </template>
            </section>

            <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700" data-cy="messages-moved">
              {{ t('Alerts to the team about a new booking or lead are in', 'Los avisos al equipo de una reserva o un lead nuevos están en') }}
              <NuxtLink to="/settings/team-alerts" data-cy="messages-team-alerts-link" class="font-semibold text-brand-text hover:underline">{{ t('Team alerts', 'Avisos al equipo') }}</NuxtLink>{{ t('; the default phone country in', '; el país de teléfono por defecto, en') }}
              <NuxtLink to="/settings/new-patient-fields" data-cy="messages-phone-country-link" class="font-semibold text-brand-text hover:underline">{{ t('New Patient Fields', 'Campos de nuevo paciente') }}</NuxtLink>{{ t('; and the Google review link in', '; y el enlace de reseñas de Google, en') }}
              <NuxtLink to="/settings/reviews" data-cy="messages-reviews-link" class="font-semibold text-brand-text hover:underline">{{ t('Reviews', 'Reseñas') }}</NuxtLink>.
            </p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
