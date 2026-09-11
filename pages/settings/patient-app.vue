<script setup lang="ts">
// What this clinic lets its patients do in the app, and a way to push an
// announcement to them.
//
// Separate from Online Booking because they are different audiences: that
// page governs strangers arriving from the website, this one governs
// existing patients who have signed in. Gating both on one switch meant a
// clinic that wanted a bookable website necessarily also let every app
// patient move their own appointments.
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()
const { can } = usePermission()

const bookingEnabled = ref(false)
const cancelEnabled = ref(false)
const rescheduleEnabled = ref(false)
const noticeHours = ref(24)

const loading = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select('patient_app_booking_enabled, patient_app_cancel_enabled, patient_app_reschedule_enabled, patient_app_change_notice_hours')
    .eq('id', store.accountId!)
    .maybeSingle()
  bookingEnabled.value = data?.patient_app_booking_enabled ?? false
  cancelEnabled.value = data?.patient_app_cancel_enabled ?? false
  rescheduleEnabled.value = data?.patient_app_reschedule_enabled ?? false
  noticeHours.value = data?.patient_app_change_notice_hours ?? 24
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  const { error } = await supabase
    .from('accounts')
    .update({
      patient_app_booking_enabled: bookingEnabled.value,
      patient_app_cancel_enabled: cancelEnabled.value,
      patient_app_reschedule_enabled: rescheduleEnabled.value,
      patient_app_change_notice_hours: noticeHours.value,
    })
    .eq('id', store.accountId!)
  saving.value = false
  showToast(error ? error.message : t('Saved.', 'Guardado.'), error ? 'error' : 'success')
}

// --- announcements ---

const authedFetch = useAuthedFetch()
const pushTitle = ref('')
const pushBody = ref('')
const sending = ref(false)

interface BroadcastRow {
  id: string
  title: string
  body: string
  recipients_count: number
  delivered_count: number
  created_at: string
  patient_ids: string[] | null
  team_members: { full_name: string } | null
}
const history = ref<BroadcastRow[]>([])

async function loadHistory() {
  const { data } = await supabase
    .from('patient_push_broadcasts')
    .select('id, title, body, recipients_count, delivered_count, created_at, patient_ids, team_members(full_name)')
    .order('created_at', { ascending: false })
    .limit(20)
  history.value = (data as unknown as BroadcastRow[]) ?? []
}
onMounted(loadHistory)

// How many people would actually get it, shown before sending rather than
// after -- "send to everyone" means something different at 3 installs than
// at 300, and there is no way to take one back.
const reachable = ref<number | null>(null)
async function loadReach() {
  const { count } = await supabase
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .not('user_id', 'is', null)
    .eq('do_not_contact', false)
    .eq('app_push_opted_out', false)
  reachable.value = count ?? 0
}
onMounted(loadReach)

async function sendAnnouncement() {
  if (!pushTitle.value.trim() || !pushBody.value.trim()) return
  const confirmed = confirm(
    t(
      `Send this to ${reachable.value ?? 0} patient(s)? It appears on their phone straight away and can't be recalled.`,
      `¿Enviar esto a ${reachable.value ?? 0} paciente(s)? Aparecerá en su móvil al momento y no se puede retirar.`,
    ),
  )
  if (!confirmed) return

  sending.value = true
  try {
    const res = await authedFetch<{ recipients: number; devices: number; delivered: number }>('/api/patient-push/send', {
      method: 'POST',
      body: { title: pushTitle.value.trim(), body: pushBody.value.trim() },
    })
    pushTitle.value = ''
    pushBody.value = ''
    showToast(
      t(
        `Sent to ${res.recipients} patient(s) on ${res.delivered} device(s).`,
        `Enviado a ${res.recipients} paciente(s) en ${res.delivered} dispositivo(s).`,
      ),
    )
    await loadHistory()
  } catch (err: unknown) {
    const message = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    showToast(message ?? t('Could not send.', 'No se pudo enviar.'), 'error')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-8 p-6">
    <div>
      <h1 class="text-lg font-semibold text-ink-900">{{ t('Patient app', 'App del paciente') }}</h1>
      <p class="mt-1 text-[13px] text-ink-muted">
        {{
          t(
            'What your patients can do from the app and the web portal. These apply to people who already have a record with you and have signed in -- booking from your public website is configured under Online Booking.',
            'Lo que tus pacientes pueden hacer desde la app y el portal web. Se aplica a quienes ya tienen ficha contigo y han iniciado sesión -- las reservas desde tu web pública se configuran en Reservas online.',
          )
        }}
      </p>
    </div>

    <div v-if="loading" class="text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>

    <template v-else>
      <section class="space-y-3 rounded-card border border-line bg-surface p-4">
        <h2 class="text-[13.5px] font-semibold text-ink-900">{{ t('Appointments', 'Citas') }}</h2>

        <label class="flex items-start gap-2.5">
          <input v-model="bookingEnabled" type="checkbox" class="mt-0.5 h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
          <span>
            <span class="block text-[13px] text-ink-900">{{ t('Let patients request a new appointment', 'Permitir que los pacientes pidan cita nueva') }}</span>
            <span class="block text-[12px] text-ink-faint">
              {{ t('Only clinics, services and practitioners marked bookable under Online Booking are offered.', 'Solo se ofrecen las clínicas, servicios y profesionales marcados como reservables en Reservas online.') }}
            </span>
          </span>
        </label>

        <label class="flex items-start gap-2.5">
          <input v-model="cancelEnabled" type="checkbox" class="mt-0.5 h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
          <span class="text-[13px] text-ink-900">{{ t('Let patients cancel an appointment', 'Permitir que los pacientes cancelen una cita') }}</span>
        </label>

        <label class="flex items-start gap-2.5">
          <input v-model="rescheduleEnabled" type="checkbox" class="mt-0.5 h-4 w-4 rounded border-line-control text-brand focus:ring-brand" />
          <span class="text-[13px] text-ink-900">{{ t('Let patients move an appointment to another time', 'Permitir que los pacientes cambien la hora de una cita') }}</span>
        </label>

        <div v-if="cancelEnabled || rescheduleEnabled" class="border-t border-line-divider pt-3">
          <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Notice required', 'Antelación mínima') }}</label>
          <div class="mt-1 flex items-center gap-2">
            <input
              v-model.number="noticeHours"
              type="number"
              min="0"
              max="336"
              class="h-8 w-24 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none"
            />
            <span class="text-[12.5px] text-ink-muted">{{ t('hours before the appointment', 'horas antes de la cita') }}</span>
          </div>
          <p class="mt-1 text-[12px] text-ink-faint">
            {{
              t(
                'Inside this window the app tells the patient to contact you instead. It also stops them moving an appointment into the window.',
                'Dentro de este margen, la app les pide que contacten contigo. También impide mover una cita a una hora dentro del margen.',
              )
            }}
          </p>
        </div>

        <div class="pt-1">
          <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        </div>
      </section>

      <section v-if="can('communication_config')" class="space-y-3 rounded-card border border-line bg-surface p-4">
        <h2 class="text-[13.5px] font-semibold text-ink-900">{{ t('Send an announcement', 'Enviar un aviso') }}</h2>
        <p class="text-[12.5px] text-ink-muted">
          {{
            t(
              `Pushes a notification to every patient who has the app installed and hasn't opted out. ${reachable ?? 0} patient(s) would receive it right now.`,
              `Envía una notificación a cada paciente que tenga la app instalada y no se haya dado de baja. Ahora mismo la recibirían ${reachable ?? 0} paciente(s).`,
            )
          }}
        </p>

        <div>
          <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Title', 'Título') }}</label>
          <input
            v-model="pushTitle"
            maxlength="64"
            class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[12.5px] font-medium text-ink-700">{{ t('Message', 'Mensaje') }}</label>
          <textarea
            v-model="pushBody"
            rows="3"
            maxlength="300"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[13.5px] text-ink-700 focus:border-brand focus:outline-none"
          />
          <p class="mt-1 text-right text-[11.5px] text-ink-faint">{{ pushBody.length }}/300</p>
        </div>
        <UiBtn variant="primary" :disabled="sending || !pushTitle.trim() || !pushBody.trim()" @click="sendAnnouncement">
          {{ sending ? t('Sending…', 'Enviando…') : t('Send to all patients', 'Enviar a todos los pacientes') }}
        </UiBtn>

        <div v-if="history.length > 0" class="border-t border-line-divider pt-3">
          <h3 class="text-[12.5px] font-medium text-ink-700">{{ t('Recently sent', 'Enviados recientemente') }}</h3>
          <ul class="mt-2 divide-y divide-line-row">
            <li v-for="b in history" :key="b.id" class="py-2">
              <p class="text-[13px] font-medium text-ink-900">{{ b.title }}</p>
              <p class="text-[12.5px] text-ink-muted">{{ b.body }}</p>
              <p class="mt-0.5 text-[11.5px] text-ink-faint">
                {{ new Date(b.created_at).toLocaleString() }}
                <template v-if="b.team_members?.full_name"> &middot; {{ b.team_members.full_name }}</template>
                &middot;
                {{
                  t(
                    `${b.patient_ids ? `${b.patient_ids.length} selected` : 'all patients'} — ${b.recipients_count} reached, ${b.delivered_count} device(s)`,
                    `${b.patient_ids ? `${b.patient_ids.length} seleccionados` : 'todos los pacientes'} — ${b.recipients_count} alcanzados, ${b.delivered_count} dispositivo(s)`,
                  )
                }}
              </p>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>
