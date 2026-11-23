<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'
import { normalizeNotifyEmail, normalizeNotifyWhatsapp } from '~/utils/notifyContacts'

// Settings > Team alerts: who at the clinic is told, the moment it happens,
// that a patient booked online or a lead came in. The two were set in two
// places -- Online Booking > Notifications and Leads > "Tell the team" --
// with the same two fields each, so a clinic changing the desk's number had
// to find both. They are one page now; both old places link here.
//
// What is sent is unchanged (server/utils/appointmentNotifications.ts and
// leadNotifications.ts): an email, and a WhatsApp that falls back to the staff
// templates chosen in Settings > WhatsApp when the number has not written in
// 24 h. Saved under communication_config: the online_booking_notify_*
// columns used to need clinic_config, from their place on Online Booking
// (20261121193000_settings_regroup_permissions.sql).

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

type Kind = 'booking' | 'lead'
const COLUMNS = {
  booking: { email: 'online_booking_notify_email', whatsapp: 'online_booking_notify_whatsapp' },
  lead: { email: 'new_lead_notify_email', whatsapp: 'new_lead_notify_whatsapp' },
} as const

const form = ref<Record<Kind, { email: string; whatsapp: string }>>({ booking: { email: '', whatsapp: '' }, lead: { email: '', whatsapp: '' } })
const saved = ref('')
const loading = ref(true)
const saving = ref(false)
const dirty = computed(() => JSON.stringify(form.value) !== saved.value)

async function load() {
  const { data } = await supabase
    .from('accounts')
    .select('online_booking_notify_email, online_booking_notify_whatsapp, new_lead_notify_email, new_lead_notify_whatsapp')
    .eq('id', store.accountId!)
    .maybeSingle()
  form.value = {
    booking: { email: data?.online_booking_notify_email ?? '', whatsapp: data?.online_booking_notify_whatsapp ?? '' },
    lead: { email: data?.new_lead_notify_email ?? '', whatsapp: data?.new_lead_notify_whatsapp ?? '' },
  }
  saved.value = JSON.stringify(form.value)
  loading.value = false
}
onMounted(load)

const SECTIONS = computed<{ kind: Kind; title: string; sub: string; template: string }[]>(() => [
  {
    kind: 'booking',
    title: t('A new online booking', 'Una reserva online nueva'),
    sub: t('Sent the moment a patient books on your booking page or in the app.', 'Se envía en cuanto un paciente reserva en tu página de reservas o en la app.'),
    template: t('the staff booking template', 'la plantilla de aviso de reserva'),
  },
  {
    kind: 'lead',
    title: t('A new lead', 'Un lead nuevo'),
    sub: t('From a Meta lead ad, the API or anywhere else. The automations answer the lead straight away; this is so a person follows up.', 'De un anuncio de Meta, la API o cualquier otro sitio. Las automatizaciones responden al lead al momento; esto es para que una persona haga el seguimiento.'),
    template: t('the new-lead alert template', 'la plantilla de aviso de lead'),
  },
])

async function save() {
  const update: TablesUpdate<'accounts'> = {}
  const before = JSON.parse(saved.value) as typeof form.value
  const next = { booking: { ...form.value.booking }, lead: { ...form.value.lead } }
  for (const { kind, title } of SECTIONS.value) {
    const email = normalizeNotifyEmail(form.value[kind].email)
    const whatsapp = normalizeNotifyWhatsapp(form.value[kind].whatsapp, store.defaultPhoneCountry)
    if (email === undefined) {
      showToast(t(`${title}: the email is not an email address.`, `${title}: el correo no es una dirección de correo.`), 'error')
      return
    }
    if (whatsapp === undefined) {
      showToast(t(`${title}: the WhatsApp is not a phone number.`, `${title}: el WhatsApp no es un número de teléfono.`), 'error')
      return
    }
    next[kind] = { email: email ?? '', whatsapp: whatsapp ?? '' }
    // Only what changed: the settings guard asks for the permission of every
    // column an update changes, and an untouched one should not be asked about.
    if (next[kind].email !== before[kind].email) update[COLUMNS[kind].email] = email
    if (next[kind].whatsapp !== before[kind].whatsapp) update[COLUMNS[kind].whatsapp] = whatsapp
  }
  form.value = next
  if (Object.keys(update).length === 0) {
    saved.value = JSON.stringify(form.value)
    return
  }
  saving.value = true
  const { error } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  saved.value = JSON.stringify(form.value)
  showToast(t('Saved', 'Guardado'))
}

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Team alerts', 'Avisos al equipo')">
      <span v-if="dirty" class="text-[13px] text-ink-muted">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
      <UiBtn variant="primary" data-cy="team-alerts-save" :disabled="saving || loading || !dirty" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="team-alerts-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Who at the clinic is told, by email or WhatsApp, the moment something comes in. Leave a field empty to send nothing that way.', 'A quién de la clínica se avisa, por correo o WhatsApp, en cuanto entra algo. Deja un campo vacío para no avisar por esa vía.') }}
          </p>

          <template v-if="loading">
            <UiSkeleton v-for="i in 2" :key="i" class="h-40 w-full rounded-card" />
          </template>
          <template v-else>
            <section
              v-for="s in SECTIONS"
              :key="s.kind"
              :aria-labelledby="`h-${s.kind}`"
              :data-cy="`team-alerts-${s.kind}`"
              class="overflow-hidden rounded-card border border-line bg-surface"
            >
              <div class="px-[18px] pb-2 pt-4">
                <h2 :id="`h-${s.kind}`" class="text-[16px] font-bold text-ink-900">{{ s.title }}</h2>
                <p class="mt-1 text-[13px] leading-snug text-ink-muted">{{ s.sub }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <label :for="`${s.kind}-notify-email`" class="min-w-[220px] flex-1 text-[14.5px] font-bold text-ink-900">{{ t('By email', 'Por correo') }}</label>
                <input
                  :id="`${s.kind}-notify-email`"
                  v-model="form[s.kind].email"
                  type="email"
                  placeholder="recepcion@clinica.es"
                  :data-cy="`${s.kind}-notify-email`"
                  :class="[inputClass, 'w-full sm:w-[300px]']"
                />
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label :for="`${s.kind}-notify-whatsapp`" class="text-[14.5px] font-bold text-ink-900">{{ t('By WhatsApp', 'Por WhatsApp') }}</label>
                  <span class="text-[13px] leading-snug text-ink-500">
                    {{ t(`In +34… format. When that number has not written to the clinic in 24 h, WhatsApp only delivers ${s.template}, set in`, `En formato +34… Si ese número no ha escrito a la clínica en 24 h, WhatsApp solo entrega ${s.template}, configurada en`) }}
                    <NuxtLink to="/settings/whatsapp" class="font-semibold text-brand-text hover:underline">WhatsApp</NuxtLink>.
                  </span>
                </div>
                <input
                  :id="`${s.kind}-notify-whatsapp`"
                  v-model="form[s.kind].whatsapp"
                  type="tel"
                  placeholder="+34600000000"
                  :data-cy="`${s.kind}-notify-whatsapp`"
                  :class="[inputClass, 'w-full sm:w-[300px]']"
                />
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
