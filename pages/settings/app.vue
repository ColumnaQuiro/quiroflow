<script setup lang="ts">
import QRCode from 'qrcode'
import { appStoreUrl, playStoreUrl } from '~/utils/appLinks'

// Everything about the patient-facing app, on one page.
//
// It used to be two, in two different sections of Settings: "Mobile App"
// under Clinic held the join code and the install counts, "Patient App"
// under Communication held the store links, what patients may do, and
// announcements. Nobody looking for one of them could guess which page it
// was on, and both answer the same question -- how a patient gets the app
// and what happens once they have it.
//
// Ordered the way a patient arrives: get them in (join code, store links),
// decide what they can do, talk to them, then see how it is going.
// /settings/patient-app redirects here so older links still land.

interface AppOpenRow {
  device_id: string
  platform: string
  last_seen_at: string
}
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

// --- store links, for sending to a patient ---

// Reception needs these often enough (a WhatsApp reply, an email signature,
// a sign for the desk) that hunting for them in the stores every time is the
// thing this section exists to stop.
const iosUrl = appStoreUrl()
const androidUrl = playStoreUrl()

const copiedKey = ref<string | null>(null)
async function copyLink(key: string, url: string) {
  await navigator.clipboard.writeText(url)
  copiedKey.value = key
  setTimeout(() => (copiedKey.value = null), 2000)
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

// --- join code and install counts, formerly /settings/app ---

const qrDataUrl = ref('')
watch(
  () => store.accountSlug,
  async (slug) => {
    if (!slug) return
    qrDataUrl.value = await QRCode.toDataURL(slug, { width: 220, margin: 1 })
  },
  { immediate: true },
)

function copy(text: string) {
  navigator.clipboard?.writeText(text)
}

const usageLoading = ref(true)
const opens = ref<AppOpenRow[]>([])
async function loadUsage() {
  if (!store.accountId) return
  usageLoading.value = true
  const { data } = await supabase.from('app_opens').select('device_id, platform, last_seen_at').eq('account_id', store.accountId)
  opens.value = data ?? []
  usageLoading.value = false
}
onMounted(loadUsage)
watch(() => store.accountId, loadUsage)

const totalDevices = computed(() => opens.value.length)
const byPlatform = computed(() => {
  const counts: Record<string, number> = { ios: 0, android: 0, web: 0 }
  for (const o of opens.value) counts[o.platform] = (counts[o.platform] ?? 0) + 1
  return counts
})
const activeLast30Days = computed(() => {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  return opens.value.filter((o) => new Date(o.last_seen_at).getTime() >= cutoff).length
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Mobile App', 'App móvil')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1 space-y-8">
          <p class="text-[13px] text-ink-muted2">
            {{
              t(
                'How patients get the QuiroFlow app, what they can do once they have it, and how many are using it. These apply to people who already have a record with you and have signed in -- booking from your public website is configured under Online Booking.',
                'Cómo consiguen los pacientes la app de QuiroFlow, qué pueden hacer con ella y cuántos la usan. Se aplica a quienes ya tienen ficha contigo y han iniciado sesión -- las reservas desde tu web pública se configuran en Reservas online.',
              )
            }}
          </p>

    <!-- Outside the loading gate below on purpose: these links are constants,
         not account settings, so someone who opened this page mid-call to
         paste a link to a patient should not wait on a round trip first. -->
    <section class="space-y-3 rounded-card border border-line bg-surface p-4">
      <div>
        <h2 class="text-[13.5px] font-semibold text-ink-900">{{ t('Share the app', 'Compartir la app') }}</h2>
        <p class="mt-1 text-[12.5px] text-ink-faint">
          {{
            t(
              'Send these to a patient so they can install it. Patients also see them on the booking confirmation and in the web portal.',
              'Envía estos enlaces a un paciente para que la instale. Los pacientes también los ven al confirmar una reserva y en el portal web.',
            )
          }}
        </p>
      </div>

      <div class="space-y-2">
        <div v-for="link in [{ key: 'ios', label: 'App Store', url: iosUrl }, { key: 'android', label: 'Google Play', url: androidUrl }]" :key="link.key">
          <div v-if="link.url" class="flex items-center gap-2">
            <span class="w-[86px] shrink-0 text-[12.5px] font-medium text-ink-700">{{ link.label }}</span>
            <code class="min-w-0 flex-1 truncate rounded-ctlSm bg-surface-subtle px-2 py-1.5 font-mono text-[12px] text-ink-600">{{ link.url }}</code>
            <UiBtn size="sm" @click="copyLink(link.key, link.url)">
              {{ copiedKey === link.key ? t('Copied', 'Copiado') : t('Copy', 'Copiar') }}
            </UiBtn>
          </div>
          <p v-else class="text-[12.5px] text-ink-faint">
            {{ t('App Store — link not set up yet.', 'App Store — enlace aún no configurado.') }}
          </p>
        </div>
      </div>

      <div class="border-t border-line-divider pt-3">
        <p class="mb-2.5 text-[12px] text-ink-faint">{{ t('How it looks to a patient', 'Cómo lo ve un paciente') }}</p>
        <AppDownloadButtons />
      </div>
    </section>

          <h2 class="mt-8 text-[15px] font-[620] text-ink-900">{{ t('Join code', 'Código de acceso') }}</h2>
          <p class="mt-1 text-[13px] text-ink-muted2">
            {{ t('New patients download the QuiroFlow app, tap "Join your clinic," and enter this code once. The same code is asked for on the web portal\'s sign-in page. Share it however you\'d like -- a printed QR by the front desk, in a welcome email, on a receipt.', 'Los nuevos pacientes descargan la app QuiroFlow, tocan "Unirse a tu clínica" e introducen este código una vez. El mismo código se pide en la página de acceso del portal web. Compártelo como prefieras -- un QR impreso en recepción, en un correo de bienvenida, en un recibo.') }}
          </p>

          <div class="mt-3 rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Clinic code', 'Código de la clínica') }}</p>
            <div class="mt-1 flex items-center gap-2">
              <input :value="store.accountSlug" readonly class="h-8 w-full rounded-ctl border border-line-control bg-surface-subtle px-2 text-[13px] text-ink-600" />
              <button
                type="button"
                class="h-8 shrink-0 rounded-ctl border border-line-control px-3 text-[12.5px] text-ink-600 hover:border-line-controlHover"
                @click="copy(store.accountSlug)"
              >
                {{ t('Copy', 'Copiar') }}
              </button>
            </div>
            <img v-if="qrDataUrl" :src="qrDataUrl" class="mx-auto mt-4 h-[180px] w-[180px]" :alt="t('QR code encoding the clinic join code', 'Código QR que codifica el código de acceso de la clínica')" />
            <p class="mt-2 text-center text-[11.5px] text-ink-faint">{{ t('Scan or type this in the app\'s "Join your clinic" screen, or in the Clinic code field on the web portal.', 'Escanéalo o escríbelo en la pantalla "Unirse a tu clínica" de la app, o en el campo Código de la clínica del portal web.') }}</p>
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

          <h2 class="mt-8 text-[15px] font-[620] text-ink-900">{{ t('App usage', 'Uso de la app') }}</h2>
          <p class="mt-1 text-[13px] text-ink-muted2">
            {{ t("Counts devices that have opened the app, not accounts -- one patient using two phones counts twice. Only counts app launches, not every time it's reopened from the background.", 'Cuenta dispositivos que han abierto la app, no cuentas -- un paciente que usa dos teléfonos cuenta dos veces. Solo cuenta los inicios de la app, no cada vez que se reabre desde segundo plano.') }}
          </p>

          <div v-if="usageLoading" class="mt-3 grid grid-cols-3 gap-3">
            <div v-for="i in 3" :key="i" class="space-y-2 rounded-card border border-line bg-surface p-4 text-center shadow-card">
              <UiSkeleton class="mx-auto h-[22px] w-12 rounded-ctlSm" />
              <UiSkeleton class="mx-auto h-3 w-24 rounded-ctlSm" />
            </div>
          </div>
          <div v-else class="mt-3 grid grid-cols-3 gap-3">
            <div class="rounded-card border border-line bg-surface p-4 text-center shadow-card">
              <p class="text-[22px] font-[640] text-ink-900">{{ totalDevices }}</p>
              <p class="mt-1 text-[12px] text-ink-muted2">{{ t('Devices installed', 'Dispositivos instalados') }}</p>
            </div>
            <div class="rounded-card border border-line bg-surface p-4 text-center shadow-card">
              <p class="text-[22px] font-[640] text-ink-900">{{ activeLast30Days }}</p>
              <p class="mt-1 text-[12px] text-ink-muted2">{{ t('Active last 30 days', 'Activos en los últimos 30 días') }}</p>
            </div>
            <div class="rounded-card border border-line bg-surface p-4 text-center shadow-card">
              <p class="text-[13px] text-ink-700">iOS {{ byPlatform.ios }} &middot; Android {{ byPlatform.android }} &middot; Web {{ byPlatform.web }}</p>
              <p class="mt-1 text-[12px] text-ink-muted2">{{ t('By platform', 'Por plataforma') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
