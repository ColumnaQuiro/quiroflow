<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const confirmationEnabled = ref(true)
const confirmationChannels = ref<string[]>(['whatsapp'])
const emailConfirmationSubject = ref('')
const emailConfirmationBody = ref('')

const reminderEnabled = ref(true)
const reminderChannels = ref<string[]>(['whatsapp'])
const reminderHoursBefore = ref(24)
const emailReminderSubject = ref('')
const emailReminderBody = ref('')

// Backs the {{google_review_link}} / "Google review link" merge field used
// by the appointment.review_request campaign trigger (Campaigns), not by
// the confirmation/reminder sends on this page -- kept here anyway since
// this is the account's one general communications settings page.
const googleReviewUrl = ref('')

const { showToast } = useToast()
const loading = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select(
      'appointment_confirmation_enabled, appointment_confirmation_channels, email_confirmation_subject, email_confirmation_body, appointment_reminder_enabled, appointment_reminder_channels, appointment_reminder_hours_before, email_reminder_subject, email_reminder_body, google_review_url',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  confirmationEnabled.value = data?.appointment_confirmation_enabled ?? true
  confirmationChannels.value = data?.appointment_confirmation_channels ?? ['whatsapp']
  emailConfirmationSubject.value = data?.email_confirmation_subject ?? ''
  emailConfirmationBody.value = data?.email_confirmation_body ?? ''
  reminderEnabled.value = data?.appointment_reminder_enabled ?? true
  reminderChannels.value = data?.appointment_reminder_channels ?? ['whatsapp']
  reminderHoursBefore.value = data?.appointment_reminder_hours_before ?? 24
  emailReminderSubject.value = data?.email_reminder_subject ?? ''
  emailReminderBody.value = data?.email_reminder_body ?? ''
  googleReviewUrl.value = data?.google_review_url ?? ''
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    appointment_confirmation_enabled: confirmationEnabled.value,
    appointment_confirmation_channels: confirmationChannels.value,
    email_confirmation_subject: emailConfirmationSubject.value.trim() || null,
    email_confirmation_body: emailConfirmationBody.value.trim() || null,
    appointment_reminder_enabled: reminderEnabled.value,
    appointment_reminder_channels: reminderChannels.value,
    appointment_reminder_hours_before: reminderHoursBefore.value,
    email_reminder_subject: emailReminderSubject.value.trim() || null,
    email_reminder_body: emailReminderBody.value.trim() || null,
    google_review_url: googleReviewUrl.value.trim() || null,
  }
  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    showToast(updateError.message, 'error')
    return
  }
  showToast('Saved')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('General', 'General')">
      <UiBtn variant="primary" :disabled="saving || loading" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{ t('Manage how appointment confirmations and reminders are sent to your patients. WhatsApp default templates are configured in', 'Gestiona cómo se envían a tus pacientes las confirmaciones y recordatorios de citas. Las plantillas predeterminadas de WhatsApp se configuran en') }} <NuxtLink to="/settings/whatsapp" class="text-brand-text hover:underline">{{ t('Settings → WhatsApp', 'Ajustes → WhatsApp') }}</NuxtLink>.
          </p>

          <div v-if="loading" class="mt-6 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
          <form v-else class="mt-5 space-y-4" @submit.prevent="save">
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Appointment Confirmations', 'Confirmaciones de cita') }}</p>
                  <p class="mt-0.5 text-[12.5px] text-ink-muted2">
                    {{ t('Sent automatically right after an appointment is booked — by staff or through online booking.', 'Se envían automáticamente justo después de reservar una cita — por el personal o mediante la reserva online.') }}
                  </p>
                </div>
                <SettingsToggle v-model="confirmationEnabled" />
              </div>

              <template v-if="confirmationEnabled">
                <div class="mt-4 flex flex-wrap gap-4 border-t border-line-divider pt-4 text-[13px] text-ink-600">
                  <label class="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      :checked="confirmationChannels.includes('whatsapp')"
                      class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand"
                      @change="confirmationChannels = ($event.target as HTMLInputElement).checked ? [...confirmationChannels, 'whatsapp'] : confirmationChannels.filter((c) => c !== 'whatsapp')"
                    />
                    WhatsApp
                  </label>
                  <label class="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      :checked="confirmationChannels.includes('email')"
                      class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand"
                      @change="confirmationChannels = ($event.target as HTMLInputElement).checked ? [...confirmationChannels, 'email'] : confirmationChannels.filter((c) => c !== 'email')"
                    />
                    {{ t('Email', 'Correo electrónico') }}
                  </label>
                </div>

                <div v-if="confirmationChannels.includes('email')" class="mt-3 space-y-2">
                  <input
                    v-model="emailConfirmationSubject"
                    type="text"
                    :placeholder="t('Subject — e.g. Your appointment is confirmed', 'Asunto — p. ej. Tu cita ha sido confirmada')"
                    class="h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                  />
                  <CampaignsRichTextEditor v-model="emailConfirmationBody" />
                  <p class="text-[11.5px] text-ink-faint">
                    {{ t('Merge fields:', 'Campos combinados:') }} <code class="rounded-ctlSm bg-surface-subtle px-1">&#123;&#123;first_name&#125;&#125;</code>
                    <code class="rounded-ctlSm bg-surface-subtle px-1">&#123;&#123;next_appointment&#125;&#125;</code>
                    <code class="rounded-ctlSm bg-surface-subtle px-1">&#123;&#123;practitioner_name&#125;&#125;</code>
                    <code class="rounded-ctlSm bg-surface-subtle px-1">&#123;&#123;appointment_type_name&#125;&#125;</code>
                  </p>
                </div>
              </template>
            </div>

            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Appointment Reminders', 'Recordatorios de cita') }}</p>
                  <p class="mt-0.5 text-[12.5px] text-ink-muted2">{{ t('Sent automatically a set number of hours before the visit.', 'Se envían automáticamente un número determinado de horas antes de la visita.') }}</p>
                </div>
                <SettingsToggle v-model="reminderEnabled" />
              </div>

              <template v-if="reminderEnabled">
                <div class="mt-4 flex items-center gap-2 border-t border-line-divider pt-4 text-[13px] text-ink-600">
                  <span>{{ t('Send', 'Enviar') }}</span>
                  <input
                    v-model.number="reminderHoursBefore"
                    type="number"
                    min="1"
                    max="168"
                    class="h-8 w-16 rounded-ctl border border-line-control bg-surface px-2 text-center text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                  />
                  <span>{{ t('hours before the appointment', 'horas antes de la cita') }}</span>
                </div>

                <div class="mt-3 flex flex-wrap gap-4 text-[13px] text-ink-600">
                  <label class="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      :checked="reminderChannels.includes('whatsapp')"
                      class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand"
                      @change="reminderChannels = ($event.target as HTMLInputElement).checked ? [...reminderChannels, 'whatsapp'] : reminderChannels.filter((c) => c !== 'whatsapp')"
                    />
                    WhatsApp
                  </label>
                  <label class="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      :checked="reminderChannels.includes('email')"
                      class="h-4 w-4 rounded border-line-control text-brand focus:ring-brand"
                      @change="reminderChannels = ($event.target as HTMLInputElement).checked ? [...reminderChannels, 'email'] : reminderChannels.filter((c) => c !== 'email')"
                    />
                    {{ t('Email', 'Correo electrónico') }}
                  </label>
                </div>

                <div v-if="reminderChannels.includes('email')" class="mt-3 space-y-2">
                  <input
                    v-model="emailReminderSubject"
                    type="text"
                    :placeholder="t('Subject — e.g. Reminder: your appointment is tomorrow', 'Asunto — p. ej. Recordatorio: tu cita es mañana')"
                    class="h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                  />
                  <CampaignsRichTextEditor v-model="emailReminderBody" />
                  <p class="text-[11.5px] text-ink-faint">
                    {{ t('Merge fields:', 'Campos combinados:') }} <code class="rounded-ctlSm bg-surface-subtle px-1">&#123;&#123;first_name&#125;&#125;</code>
                    <code class="rounded-ctlSm bg-surface-subtle px-1">&#123;&#123;next_appointment&#125;&#125;</code>
                    <code class="rounded-ctlSm bg-surface-subtle px-1">&#123;&#123;practitioner_name&#125;&#125;</code>
                    <code class="rounded-ctlSm bg-surface-subtle px-1">&#123;&#123;appointment_type_name&#125;&#125;</code>
                  </p>
                </div>
              </template>
            </div>

            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Google Reviews', 'Reseñas de Google') }}</p>
              <p class="mt-0.5 text-[12.5px] text-ink-muted2">
                {{ t('Used by the "X days after visit (review request)" campaign trigger in Campaigns, as the Google review link merge field.', 'Se usa en el disparador de campaña "X días después de la visita (solicitud de reseña)" en Campañas, como campo combinado del enlace de reseña de Google.') }}
              </p>
              <input
                v-model="googleReviewUrl"
                type="url"
                placeholder="https://g.page/r/…/review"
                class="mt-3 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>

          </form>
        </div>
      </div>
    </div>
  </div>
</template>
