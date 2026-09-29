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
// Usage sits at the top as a glance strip; below it the page follows the
// way a patient arrives: get them in (join code, QR, store links), decide
// what they can do, then talk to them.
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

// The same code as a PNG big enough to print, for a clinic laying out its
// own sign or leaflet rather than using the desk sign below.
async function downloadQr() {
  if (!store.accountSlug) return
  const url = await QRCode.toDataURL(store.accountSlug, { width: 1024, margin: 2 })
  const a = document.createElement('a')
  a.href = url
  a.download = `quiroflow-${store.accountSlug}-qr.png`
  a.click()
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
const platformShare = (key: string) => (totalDevices.value ? `${(byPlatform.value[key] / totalDevices.value) * 100}%` : '0%')
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
        <div class="flex min-w-0 max-w-[980px] flex-1 flex-col gap-4">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('How patients get the QuiroFlow app, what they can do in it, and how many use it. Booking from your public website is set under', 'Cómo consiguen los pacientes la app de QuiroFlow, qué pueden hacer con ella y cuántos la usan. Las reservas desde tu web pública se configuran en') }}
            <NuxtLink to="/settings/online-booking" class="font-medium text-brand-text hover:underline">{{ t('Online Booking', 'Reservas online') }}</NuxtLink>.
          </p>

          <!-- Usage: a glance strip up top rather than the page's last section. -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3" data-cy="app-usage">
            <div class="flex flex-col gap-1 rounded-card border border-line bg-surface px-[18px] py-4">
              <span class="text-[12.5px] font-semibold text-ink-muted">{{ t('Devices installed', 'Dispositivos instalados') }}</span>
              <UiSkeleton v-if="usageLoading" class="mt-1 h-7 w-12 rounded-ctlSm" />
              <strong v-else class="text-[28px] font-[640] tracking-tightTitle text-ink-900">{{ totalDevices }}</strong>
            </div>
            <div class="flex flex-col gap-1 rounded-card border border-line bg-surface px-[18px] py-4">
              <span class="text-[12.5px] font-semibold text-ink-muted">{{ t('Active in the last 30 days', 'Activos en los últimos 30 días') }}</span>
              <UiSkeleton v-if="usageLoading" class="mt-1 h-7 w-12 rounded-ctlSm" />
              <strong v-else class="text-[28px] font-[640] tracking-tightTitle text-ink-900">{{ activeLast30Days }}</strong>
            </div>
            <div class="flex flex-col gap-2.5 rounded-card border border-line bg-surface px-[18px] py-4">
              <span class="text-[12.5px] font-semibold text-ink-muted">{{ t('By platform', 'Por plataforma') }}</span>
              <div class="flex h-2.5 gap-0.5 overflow-hidden rounded-pill bg-chip-bg" aria-hidden="true">
                <span class="bg-brand" :style="{ width: platformShare('ios') }" />
                <span class="bg-brand/55" :style="{ width: platformShare('android') }" />
                <span class="bg-brand-tintBorder" :style="{ width: platformShare('web') }" />
              </div>
              <div class="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-ink-500">
                <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-[2px] bg-brand" aria-hidden="true" />iOS {{ byPlatform.ios }}</span>
                <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-[2px] bg-brand/55" aria-hidden="true" />Android {{ byPlatform.android }}</span>
                <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-[2px] bg-brand-tintBorder" aria-hidden="true" />Web {{ byPlatform.web }}</span>
              </div>
            </div>
          </div>
          <p class="-mt-1.5 text-[12.5px] text-ink-muted">
            {{ t('Counts devices, not patients: one patient on two phones counts twice. Only app launches count, not every return from the background.', 'Cuenta dispositivos, no pacientes: un paciente con dos teléfonos cuenta dos veces. Solo cuentan los inicios de la app, no cada vuelta desde segundo plano.') }}
          </p>

          <!-- Outside the loading gate below on purpose: the code and the store
               links are not account settings, so someone who opened this page
               mid-call to paste one to a patient should not wait on a round
               trip first. -->
          <section aria-labelledby="h-share" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="px-[18px] pt-4">
              <h2 id="h-share" class="text-[16px] font-bold text-ink-900">{{ t('Share the app', 'Compartir la app') }}</h2>
              <p class="mt-1 text-[13.5px] leading-snug text-ink-muted">
                {{ t('Patients install QuiroFlow, tap "Join your clinic" and enter this code once. The web portal\'s sign-in asks for the same code.', 'Los pacientes instalan QuiroFlow, tocan "Unirse a tu clínica" e introducen este código una vez. El acceso al portal web pide el mismo código.') }}
              </p>
            </div>

            <div class="flex flex-col gap-6 px-[18px] pb-[18px] pt-4 sm:flex-row sm:items-center">
              <div class="flex min-w-0 flex-1 flex-col gap-2.5">
                <span class="text-[12.5px] font-semibold text-ink-500">{{ t('Clinic code', 'Código de la clínica') }}</span>
                <div class="flex items-center gap-2.5">
                  <code class="flex h-[52px] min-w-0 flex-1 items-center truncate rounded-ctl border border-line bg-surface-page px-4 font-mono text-[22px] font-medium tracking-[.04em] text-ink-900" data-cy="app-join-code">{{ store.accountSlug }}</code>
                  <UiBtn class="!h-[52px]" data-cy="app-join-code-copy" @click="copyLink('code', store.accountSlug)">
                    {{ copiedKey === 'code' ? t('Copied', 'Copiado') : t('Copy code', 'Copiar código') }}
                  </UiBtn>
                </div>
                <div class="mt-1 flex flex-wrap gap-2">
                  <NuxtLink to="/print/desk-sign" target="_blank" data-cy="app-desk-sign" class="inline-flex h-9 touch:h-11 items-center gap-1.5 rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z" /></svg>
                    {{ t('Print a desk sign', 'Imprimir un cartel') }}
                  </NuxtLink>
                  <UiBtn data-cy="app-qr-download" :disabled="!store.accountSlug" @click="downloadQr">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                    {{ t('Download QR', 'Descargar QR') }}
                  </UiBtn>
                </div>
              </div>
              <figure class="flex w-[168px] shrink-0 flex-col items-center gap-2 self-center">
                <img v-if="qrDataUrl" :src="qrDataUrl" class="h-[148px] w-[148px] rounded-card border border-line bg-white p-1.5" :alt="t('QR code encoding the clinic join code', 'Código QR que codifica el código de acceso de la clínica')" />
                <UiSkeleton v-else class="h-[148px] w-[148px] rounded-card" />
                <figcaption class="text-center text-[12px] text-ink-muted">{{ t('Scan in "Join your clinic"', 'Escanéalo en "Unirse a tu clínica"') }}</figcaption>
              </figure>
            </div>

            <div class="flex flex-col gap-2.5 border-t border-line-row px-[18px] pb-4 pt-3.5">
              <span class="text-[12.5px] font-semibold text-ink-500">{{ t('Store links, to send to a patient', 'Enlaces de las tiendas, para enviar a un paciente') }}</span>
              <div v-for="link in [{ key: 'ios', label: 'App Store', url: iosUrl }, { key: 'android', label: 'Google Play', url: androidUrl }]" :key="link.key">
                <div v-if="link.url" class="flex items-center gap-2.5">
                  <span class="w-24 shrink-0 text-[13.5px] font-semibold text-ink-700">{{ link.label }}</span>
                  <code class="min-w-0 flex-1 truncate rounded-ctlSm bg-surface-page px-2.5 py-2 font-mono text-[12.5px] text-ink-500">{{ link.url }}</code>
                  <UiBtn class="w-24" :class="copiedKey === link.key ? '!border-success-border !bg-success-bg !text-success-text' : ''" @click="copyLink(link.key, link.url)">
                    {{ copiedKey === link.key ? t('Copied', 'Copiado') : t('Copy', 'Copiar') }}
                  </UiBtn>
                </div>
                <p v-else class="text-[12.5px] text-ink-muted">
                  {{ t('App Store — link not set up yet.', 'App Store — enlace aún no configurado.') }}
                </p>
              </div>
              <div class="mt-1 border-t border-line-row pt-3">
                <p class="mb-2.5 text-[12px] text-ink-muted">{{ t('How it looks to a patient', 'Cómo lo ve un paciente') }}</p>
                <AppDownloadButtons />
              </div>
            </div>
          </section>

          <div v-if="loading" class="rounded-card border border-line bg-surface p-[18px]">
            <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
            <UiSkeleton class="mt-4 h-4 w-72 rounded-ctlSm" />
          </div>

          <template v-else>
            <section aria-labelledby="h-can" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-2 pt-4">
                <h2 id="h-can" class="text-[16px] font-bold text-ink-900">{{ t('What patients can do', 'Qué pueden hacer los pacientes') }}</h2>
                <p class="mt-1 text-[13.5px] text-ink-muted">{{ t('For patients who already have a record with you and have signed in.', 'Para pacientes que ya tienen ficha contigo y han iniciado sesión.') }}</p>
              </div>
              <div class="px-[18px]">
                <SettingsSwitchRow
                  v-model="bookingEnabled"
                  data-cy="app-booking"
                  :title="t('Request a new appointment', 'Pedir una cita nueva')"
                  :description="t('Only clinics, services and practitioners bookable under Online Booking are offered.', 'Solo se ofrecen las clínicas, servicios y profesionales reservables en Reservas online.')"
                />
                <SettingsSwitchRow v-model="cancelEnabled" data-cy="app-cancel" :title="t('Cancel an appointment', 'Cancelar una cita')" />
                <SettingsSwitchRow v-model="rescheduleEnabled" data-cy="app-reschedule" :title="t('Move an appointment to another time', 'Cambiar la hora de una cita')" />
                <div v-if="cancelEnabled || rescheduleEnabled" class="flex flex-wrap items-center gap-3.5 border-t border-line-row py-3">
                  <div class="flex min-w-[240px] flex-1 flex-col gap-0.5">
                    <label for="notice-hours" class="text-[14.5px] font-bold text-ink-900">{{ t('Notice required to cancel or move', 'Antelación mínima para cancelar o cambiar') }}</label>
                    <span class="text-[13px] leading-snug text-ink-500">
                      {{ t('Inside this window the app asks the patient to contact you instead, and will not move an appointment into it.', 'Dentro de este margen la app pide al paciente que contacte contigo, y no mueve una cita a una hora dentro de él.') }}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      id="notice-hours"
                      v-model.number="noticeHours"
                      type="number"
                      min="0"
                      max="336"
                      class="h-9 touch:h-11 w-20 rounded-ctl border border-line-control bg-surface px-3 text-right text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                    <span class="text-[13.5px] text-ink-500">{{ t('hours before', 'horas antes') }}</span>
                  </div>
                </div>
              </div>
              <div class="flex justify-end border-t border-line bg-surface-subtle px-[18px] py-3">
                <UiBtn variant="primary" data-cy="app-save" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
              </div>
            </section>

            <section v-if="can('communication_config')" aria-labelledby="h-announce" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pt-4">
                <h2 id="h-announce" class="text-[16px] font-bold text-ink-900">{{ t('Send an announcement', 'Enviar un aviso') }}</h2>
                <p class="mt-1 text-[13.5px] leading-snug text-ink-muted">
                  {{ t('A push notification to every patient with the app who has not opted out. It cannot be recalled.', 'Una notificación a cada paciente con la app que no se haya dado de baja. No se puede retirar.') }}
                </p>
              </div>
              <div class="flex flex-col gap-6 px-[18px] pb-[18px] pt-3.5 md:flex-row">
                <form class="flex min-w-0 flex-1 flex-col gap-3.5" @submit.prevent="sendAnnouncement">
                  <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                    <span class="flex justify-between">{{ t('Title', 'Título') }} <span class="font-normal text-ink-muted">{{ pushTitle.length }}/64</span></span>
                    <input v-model="pushTitle" maxlength="64" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                  </label>
                  <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                    <span class="flex justify-between">{{ t('Message', 'Mensaje') }} <span class="font-normal text-ink-muted">{{ pushBody.length }}/300</span></span>
                    <textarea v-model="pushBody" rows="4" maxlength="300" class="resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] font-normal leading-snug text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                  </label>
                  <div class="flex flex-wrap items-center gap-3">
                    <UiBtn variant="primary" type="submit" data-cy="app-announce-send" :disabled="sending || !pushTitle.trim() || !pushBody.trim()">
                      {{ sending ? t('Sending…', 'Enviando…') : reachable === null ? t('Send to all patients', 'Enviar a todos los pacientes') : t(`Send to ${reachable} patient(s)`, `Enviar a ${reachable} paciente(s)`) }}
                    </UiBtn>
                    <span class="text-[13px] text-ink-muted">{{ t('Patients with the app who have not opted out.', 'Pacientes con la app que no se han dado de baja.') }}</span>
                  </div>
                </form>
                <div class="flex w-full shrink-0 flex-col gap-2 md:w-[320px]">
                  <span class="text-[12.5px] font-semibold text-ink-500">{{ t('Preview', 'Vista previa') }}</span>
                  <div class="flex flex-1 items-start rounded-[14px] bg-brand-tint px-4 py-5">
                    <div class="flex w-full gap-2.5 rounded-[14px] bg-surface/95 p-3 shadow-popover">
                      <span class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-ctl bg-brand text-[16px] font-bold text-white" aria-hidden="true">Q</span>
                      <div class="flex min-w-0 flex-col gap-0.5">
                        <div class="flex justify-between gap-2 text-[12px] text-ink-muted"><span>QuiroFlow</span><span>{{ t('now', 'ahora') }}</span></div>
                        <strong class="break-words text-[13.5px] text-ink-900">{{ pushTitle.trim() || t('Your title', 'Tu título') }}</strong>
                        <span class="break-words text-[13px] leading-snug text-ink-700">{{ pushBody.trim() || t('Your message appears here.', 'Tu mensaje aparece aquí.') }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="history.length > 0" class="border-t border-line">
                <h3 class="px-[18px] pb-1.5 pt-3.5 text-[13.5px] font-bold text-ink-700">{{ t('Recently sent', 'Enviados recientemente') }}</h3>
                <ul>
                  <li v-for="b in history" :key="b.id" class="flex flex-col gap-1 border-t border-line-row px-[18px] py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <strong class="text-[14px] text-ink-900">{{ b.title }}</strong>
                      <span class="truncate text-[13px] text-ink-500">{{ b.body }}</span>
                    </div>
                    <span class="shrink-0 text-[12.5px] text-ink-muted sm:text-right">
                      {{ new Date(b.created_at).toLocaleString() }}<template v-if="b.team_members?.full_name"> · {{ b.team_members.full_name }}</template><br class="max-sm:hidden" />
                      <span class="sm:hidden"> · </span>
                      {{
                        t(
                          `${b.patient_ids ? `${b.patient_ids.length} selected` : 'All patients'} · ${b.recipients_count} reached, ${b.delivered_count} device(s)`,
                          `${b.patient_ids ? `${b.patient_ids.length} seleccionados` : 'Todos los pacientes'} · ${b.recipients_count} alcanzados, ${b.delivered_count} dispositivo(s)`,
                        )
                      }}
                    </span>
                  </li>
                </ul>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
