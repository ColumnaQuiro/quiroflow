<script setup lang="ts">
import { centsToInput, parseEurosToCents } from '~/utils/appointmentTypes'
import { normalizeNotifyEmail, normalizeNotifyWhatsapp } from '~/utils/notifyContacts'
import type { TablesUpdate } from '~/types/database.types'

// How the Growth › Leads board moves and what it is worth.
//
// Booked and Showed follow the calendar on their own (the
// leads_follow_appointments trigger); Converted does too once the clinic says
// what makes a patient -- a number of attended visits, of one appointment type
// or any. The default value is what a lead with no figure of its own counts
// as on the board and the dashboard, which is every lead a Meta form sends.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const INPUT = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

const defaultValue = ref('')
// Who is told when a lead arrives. Moved here from Communication > General
// (now Messages): it is only about leads. The matching WhatsApp template is
// the new-lead alert in Settings > WhatsApp.
const notifyEmail = ref('')
const notifyWhatsapp = ref('')
const autoConvert = ref(false)
const convertAfter = ref(1)
const convertTypeId = ref('')
const appointmentTypes = ref<{ id: string; name: string; archived_at: string | null }[]>([])

const loading = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const [{ data }, { data: types }] = await Promise.all([
    supabase.from('accounts').select('lead_default_value_cents, lead_convert_after_visits, lead_convert_appointment_type_id, new_lead_notify_email, new_lead_notify_whatsapp').eq('id', store.accountId!).maybeSingle(),
    supabase.from('appointment_types').select('id, name, archived_at').order('name'),
  ])
  defaultValue.value = centsToInput(data?.lead_default_value_cents)
  autoConvert.value = data?.lead_convert_after_visits != null
  convertAfter.value = data?.lead_convert_after_visits ?? 1
  convertTypeId.value = data?.lead_convert_appointment_type_id ?? ''
  notifyEmail.value = data?.new_lead_notify_email ?? ''
  notifyWhatsapp.value = data?.new_lead_notify_whatsapp ?? ''
  appointmentTypes.value = (types ?? []) as typeof appointmentTypes.value
  loading.value = false
}
onMounted(load)

// Archived types stay listed only when one is the current choice, so the
// select never shows a blank for a saved setting.
const typeOptions = computed(() => appointmentTypes.value.filter((ty) => !ty.archived_at || ty.id === convertTypeId.value))

async function save() {
  // Read as Spain writes it: "1.500" is fifteen hundred, not 1,50 €, and
  // "1.500,00" is the same amount rather than an error.
  const cents = parseEurosToCents(defaultValue.value)
  if (cents !== null && (!Number.isFinite(cents) || cents < 0)) {
    showToast(t('The default value has to be an amount in euros, or empty.', 'El valor por defecto tiene que ser un importe en euros, o quedar vacío.'), 'error')
    return
  }
  const visits = Math.round(Number(convertAfter.value))
  if (autoConvert.value && (!Number.isFinite(visits) || visits < 1 || visits > 50)) {
    showToast(t('The number of visits has to be between 1 and 50.', 'El número de visitas tiene que estar entre 1 y 50.'), 'error')
    return
  }
  const notifyEmailValue = normalizeNotifyEmail(notifyEmail.value)
  const notifyWhatsappValue = normalizeNotifyWhatsapp(notifyWhatsapp.value, store.defaultPhoneCountry)
  if (notifyEmailValue === undefined) {
    showToast(t('The alert email is not an email address.', 'El correo de aviso no es una dirección de correo.'), 'error')
    return
  }
  if (notifyWhatsappValue === undefined) {
    showToast(t('The alert WhatsApp is not a phone number.', 'El WhatsApp de aviso no es un número de teléfono.'), 'error')
    return
  }
  notifyEmail.value = notifyEmailValue ?? ''
  notifyWhatsapp.value = notifyWhatsappValue ?? ''
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    lead_default_value_cents: cents,
    lead_convert_after_visits: autoConvert.value ? visits : null,
    lead_convert_appointment_type_id: autoConvert.value && convertTypeId.value ? convertTypeId.value : null,
    new_lead_notify_email: notifyEmailValue,
    new_lead_notify_whatsapp: notifyWhatsappValue,
  }
  const { error } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Saved', 'Guardado'))
}

// The pipeline, drawn: which steps move by themselves and when. Lost is set
// by hand from any step and is not a step of its own here.
const STAGES = computed(() => [
  { key: 'new', name: t('New', 'Nuevo'), auto: true, when: t('When the enquiry arrives.', 'Cuando llega la solicitud.') },
  { key: 'contacted', name: t('Contacted', 'Contactado'), auto: false, when: t('Someone has spoken to them.', 'Alguien ha hablado con él.') },
  { key: 'qualified', name: t('Qualified', 'Cualificado'), auto: false, when: t('Worth a first visit.', 'Merece una primera visita.') },
  { key: 'booked', name: t('Booked', 'Reservado'), auto: true, when: t('An appointment is made, however it is booked. Matched by email or phone.', 'Se le reserva una cita, como sea. Se enlaza por email o teléfono.') },
  { key: 'showed', name: t('Showed', 'Asistió'), auto: true, when: t('Checked in, or the visit completed.', 'Check-in hecho, o la visita completada.') },
  {
    key: 'converted',
    name: t('Converted', 'Convertido'),
    auto: autoConvert.value,
    when: autoConvert.value ? t(`After ${convertAfter.value} attended visit(s).`, `Tras ${convertAfter.value} visita(s) asistida(s).`) : t('By hand, unless switched on below.', 'A mano, salvo que lo actives abajo.'),
  },
])
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Leads', 'Leads')">
      <UiBtn variant="primary" :disabled="saving || loading" data-test="save-lead-settings" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="leads-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('How enquiries move along Growth › Leads, what each is worth, and who is told when one arrives.', 'Cómo avanzan las solicitudes en Crecimiento › Leads, cuánto vale cada una y a quién se avisa cuando llega.') }}
          </p>

          <template v-if="loading">
            <UiSkeleton v-for="i in 3" :key="i" class="h-32 w-full rounded-card" />
          </template>
          <template v-else>
            <!-- The pipeline, drawn: which steps move on their own -->
            <section aria-labelledby="h-pipe" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-3 pt-4">
                <h2 id="h-pipe" class="text-[16px] font-bold text-ink-900">{{ t('The pipeline', 'El embudo') }}</h2>
                <p class="mt-1 text-[13px] leading-snug text-ink-muted">
                  {{ t('Leads only move forward, never out of Lost, and only for appointments on or after the day the lead came in. Lost is set by hand, from any step.', 'Los leads solo avanzan, nunca salen de Perdido, y solo cuentan las citas del día en que llegó o posteriores. Perdido se marca a mano, desde cualquier paso.') }}
                </p>
              </div>
              <ol class="grid grid-cols-2 gap-1.5 px-[18px] pb-[18px] sm:grid-cols-3 lg:grid-cols-6" data-cy="lead-stages">
                <li v-for="s in STAGES" :key="s.key" :data-stage="s.key" class="flex min-h-[120px] flex-col gap-1.5 rounded-[10px] border p-3" :class="s.auto ? 'border-brand-tintBorder bg-brand-tint' : 'border-line-row bg-surface-subtle'">
                  <strong class="text-[13.5px] text-ink-900">{{ s.name }}</strong>
                  <span class="inline-flex h-5 items-center self-start rounded-pill px-2 text-[11px] font-bold" :class="s.auto ? 'bg-surface text-brand-text' : 'bg-chip-bg text-ink-500'">{{ s.auto ? t('Automatic', 'Automático') : t('By hand', 'A mano') }}</span>
                  <span class="text-[12px] leading-snug text-ink-500">{{ s.when }}</span>
                </li>
              </ol>
            </section>

            <!-- Converting -->
            <section aria-labelledby="h-conv" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="flex items-start gap-4 px-[18px] pb-3.5 pt-4">
                <div class="flex-1">
                  <h2 id="h-conv" class="text-[16px] font-bold text-ink-900">{{ t('Convert automatically', 'Convertir automáticamente') }}</h2>
                  <p class="mt-1 text-[13px] leading-snug text-ink-muted">{{ t('Move a lead to Converted once they have attended enough visits. Off, Converted is a move you make by hand.', 'Pasa un lead a Convertido cuando haya asistido a suficientes visitas. Desactivado, Convertido se marca a mano.') }}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  data-test="auto-convert-toggle"
                  :aria-checked="autoConvert"
                  aria-labelledby="h-conv"
                  class="relative h-[26px] w-11 shrink-0 rounded-full"
                  :class="autoConvert ? 'bg-brand' : 'bg-line-control'"
                  @click="autoConvert = !autoConvert"
                >
                  <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="autoConvert ? 'left-[21px]' : 'left-[3px]'" />
                </button>
              </div>
              <div v-if="autoConvert" class="flex flex-wrap items-center gap-2.5 border-t border-line-row px-[18px] py-3.5 text-[14px] text-ink-500">
                <span>{{ t('After', 'Tras') }}</span>
                <input v-model.number="convertAfter" type="number" min="1" max="50" :aria-label="t('Attended visits', 'Visitas asistidas')" :class="[INPUT, 'w-16 text-right']" data-test="convert-after" />
                <span>{{ t('attended visits of', 'visitas asistidas de') }}</span>
                <select v-model="convertTypeId" :aria-label="t('Appointment type', 'Tipo de cita')" :class="[INPUT, 'min-w-[220px]']" data-test="convert-type">
                  <option value="">{{ t('any appointment type', 'cualquier tipo de cita') }}</option>
                  <option v-for="ty in typeOptions" :key="ty.id" :value="ty.id">{{ ty.name }}</option>
                </select>
              </div>
            </section>

            <!-- Value -->
            <section class="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface px-[18px] py-4">
              <div class="flex min-w-[240px] flex-1 flex-col gap-0.5">
                <label for="lead-value" class="text-[16px] font-bold text-ink-900">{{ t('Default value', 'Valor por defecto') }}</label>
                <span class="text-[13px] leading-snug text-ink-500">
                  {{ t("What a lead is worth when it has no value of its own -- leads from Meta forms never do. Used on the board's totals and the dashboard; a value set on a lead always wins.", 'Lo que vale un lead sin valor propio -- los de formularios de Meta nunca lo tienen. Se usa en los totales del tablero y en el panel; el valor de un lead siempre prevalece.') }}
                </span>
              </div>
              <label class="flex items-center gap-2 text-[14px] text-ink-500">
                <input id="lead-value" v-model="defaultValue" inputmode="decimal" :placeholder="t('None', 'Ninguno')" :class="[INPUT, 'w-28 text-right']" data-test="default-lead-value" />
                €
              </label>
            </section>

            <!-- Alerts, moved here from Communication › General -->
            <section aria-labelledby="h-alert" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="lead-alerts">
              <div class="px-[18px] pb-2 pt-4">
                <h2 id="h-alert" class="text-[16px] font-bold text-ink-900">{{ t('Tell the team when a lead arrives', 'Avisar al equipo cuando llega un lead') }}</h2>
                <p class="mt-1 text-[13px] leading-snug text-ink-muted">
                  {{ t('From a Meta lead ad, the API or anywhere else. The automations answer the lead straight away; this is so a person follows up.', 'De un anuncio de Meta, la API o cualquier otro sitio. Las automatizaciones responden al lead al momento; esto es para que una persona haga el seguimiento.') }}
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <label for="lead-notify-email" class="min-w-[220px] flex-1 text-[14.5px] font-bold text-ink-900">{{ t('By email', 'Por correo') }}</label>
                <input id="lead-notify-email" v-model="notifyEmail" type="email" placeholder="recepcion@clinica.es" data-cy="lead-notify-email" :class="[INPUT, 'w-full sm:w-[300px]']" />
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="lead-notify-whatsapp" class="text-[14.5px] font-bold text-ink-900">{{ t('By WhatsApp', 'Por WhatsApp') }}</label>
                  <span class="text-[13px] leading-snug text-ink-500">
                    {{ t('In +34… format. When that number has not written to the clinic in 24 h, WhatsApp only delivers the new-lead alert template set in', 'En formato +34… Si ese número no ha escrito a la clínica en 24 h, WhatsApp solo entrega la plantilla de aviso de lead configurada en') }}
                    <NuxtLink to="/settings/whatsapp" class="font-semibold text-brand-text hover:underline">WhatsApp</NuxtLink>.
                  </span>
                </div>
                <input id="lead-notify-whatsapp" v-model="notifyWhatsapp" type="tel" placeholder="+34600000000" data-cy="lead-notify-whatsapp" :class="[INPUT, 'w-full sm:w-[300px]']" />
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
