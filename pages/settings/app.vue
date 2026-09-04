<script setup lang="ts">
import QRCode from 'qrcode'

interface AppOpenRow {
  device_id: string
  platform: string
  last_seen_at: string
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

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

const loading = ref(true)
const opens = ref<AppOpenRow[]>([])
async function load() {
  if (!store.accountId) return
  loading.value = true
  const { data } = await supabase.from('app_opens').select('device_id, platform, last_seen_at').eq('account_id', store.accountId)
  opens.value = data ?? []
  loading.value = false
}
onMounted(load)
watch(() => store.accountId, load)

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
    <PageHeader :title="t('Mobile App', 'App Móvil')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t("Your clinic's join code for the QuiroFlow app, and how many patients are using it.", 'El código de acceso de tu clínica para la app QuiroFlow, y cuántos pacientes la están usando.') }}</p>

          <h2 class="mt-8 text-[15px] font-[620] text-ink-900">{{ t('Join code', 'Código de acceso') }}</h2>
          <p class="mt-1 text-[13px] text-ink-muted2">
            {{ t('New patients download the QuiroFlow app, tap "Join your clinic," and enter this code once. Share it however you\'d like -- a printed QR by the front desk, in a welcome email, on a receipt.', 'Los nuevos pacientes descargan la app QuiroFlow, tocan "Unirse a tu clínica" e introducen este código una vez. Compártelo como prefieras -- un QR impreso en recepción, en un correo de bienvenida, en un recibo.') }}
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
            <p class="mt-2 text-center text-[11.5px] text-ink-faint">{{ t('Scan or type this in the app\'s "Join your clinic" screen.', 'Escanéalo o escríbelo en la pantalla "Unirse a tu clínica" de la app.') }}</p>
          </div>

          <h2 class="mt-8 text-[15px] font-[620] text-ink-900">{{ t('App usage', 'Uso de la app') }}</h2>
          <p class="mt-1 text-[13px] text-ink-muted2">
            {{ t("Counts devices that have opened the app, not accounts -- one patient using two phones counts twice. Only counts app launches, not every time it's reopened from the background.", 'Cuenta dispositivos que han abierto la app, no cuentas -- un paciente que usa dos teléfonos cuenta dos veces. Solo cuenta los inicios de la app, no cada vez que se reabre desde segundo plano.') }}
          </p>

          <div v-if="loading" class="mt-3 grid grid-cols-3 gap-3">
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
