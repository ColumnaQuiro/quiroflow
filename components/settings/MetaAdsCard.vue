<script setup lang="ts">
// What the clinic spends on Meta ads, read in so Growth can put cost per lead
// and cost per new patient beside the leads those ads brought -- instead of
// somebody typing the month's spend in by hand.
//
// Read-only on purpose: the connection asks for ads_read and nothing else, so
// nothing it stores can create, change or pay for an ad.
//
// Connect is the route. The paste-a-token fields stay only for a deployment
// without the Connect button, or a clinic already set up that way.

interface Status {
  adAccountId: string | null
  hasToken: boolean
  name: string | null
  currency: string | null
  /** When Meta stops accepting the connection; a user token lasts 60 days. */
  expiresAt: string | null
  error: string | null
}
interface Choice {
  adAccountId: string
  name: string | null
  currency: string | null
}
interface ConnectResult {
  connected: boolean
  adAccountId?: string
  name?: string | null
  choose?: Choice[]
  ticket?: string
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()
const meta = useFacebookPageConnect('metaAds')

const status = ref<Status | null>(null)
const loading = ref(true)
const connecting = ref(false)
const choices = ref<Choice[]>([])
const ticket = ref('')
const connectError = ref('')
const confirmingDisconnect = ref(false)
const disconnecting = ref(false)
const syncing = ref(false)

// The by-hand fallback.
const manualId = ref('')
const manualToken = ref('')
const savingManual = ref(false)

async function load() {
  try {
    status.value = await useStaffFetch<Status>('/api/meta/ads')
    manualId.value = status.value.adAccountId ?? ''
  } catch (err: any) {
    connectError.value = err?.data?.statusMessage ?? t('Could not load the connection.', 'No se pudo cargar la conexión.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const connected = computed(() => Boolean(status.value?.adAccountId && status.value?.hasToken))
const label = computed(() => status.value?.name ?? (status.value?.adAccountId ? `act_${status.value.adAccountId.replace(/^act_/, '')}` : ''))
// A connected account billing in anything but euros cannot be read in:
// channel_spend has no currency column, so the sync refuses it. Said here,
// where it can be fixed, rather than only as a failed sync on the dashboard.
// Meta gives this connection 60 days and no way to renew it without the
// person signing in again, so the card says by when, and turns to a warning
// in the last two weeks -- before spend quietly stops being read.
const renewBy = computed(() => (status.value?.expiresAt ? new Date(status.value.expiresAt) : null))
const renewSoon = computed(() => Boolean(renewBy.value && renewBy.value.getTime() - Date.now() < 14 * 86_400_000))
const renewByLabel = computed(() => (renewBy.value ? renewBy.value.toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'long' }) : ''))
const wrongCurrency = computed(() => Boolean(status.value?.currency && status.value.currency !== 'EUR'))
const showManual = computed(() => !meta.available.value || (status.value?.adAccountId && !connected.value))

async function connect() {
  connecting.value = true
  choices.value = []
  connectError.value = ''
  try {
    const code = await meta.launch()
    const result = await useStaffFetch<ConnectResult>('/api/meta/ads/connect', { method: 'POST', body: { code, redirectUri: meta.redirectUri } })
    if (result.choose?.length && result.ticket) {
      choices.value = result.choose
      ticket.value = result.ticket
      showToast(t('One more step: choose which ad account is this clinic’s.', 'Un paso más: elige cuál es la cuenta publicitaria de esta clínica.'), 'info', 8000)
      return
    }
    await done(result)
  } catch (err: any) {
    if (err?.message === 'CANCELLED') return
    failed(err)
  } finally {
    connecting.value = false
  }
}

async function pick(adAccountId: string) {
  connecting.value = true
  connectError.value = ''
  try {
    const result = await useStaffFetch<ConnectResult>('/api/meta/ads/connect', { method: 'POST', body: { ticket: ticket.value, adAccountId } })
    choices.value = []
    ticket.value = ''
    await done(result)
  } catch (err: any) {
    failed(err)
  } finally {
    connecting.value = false
  }
}

function failed(err: any) {
  connectError.value = err?.data?.statusMessage ?? err?.message ?? t('Could not connect Meta Ads.', 'No se pudo conectar Meta Ads.')
  showToast(connectError.value, 'error')
}

async function done(result: ConnectResult) {
  const which = result.name ?? result.adAccountId
  showToast(t(`Meta Ads connected: ${which}.`, `Meta Ads conectado: ${which}.`), 'success')
  await load()
}

async function syncNow() {
  syncing.value = true
  try {
    const result = await useStaffFetch<{ imported: boolean; amountCents?: number }>('/api/growth/sync-ad-spend', { method: 'POST' })
    showToast(
      result.imported
        ? t(`This month so far: ${formatMoney(result.amountCents ?? 0)}. It is on the Growth dashboard.`, `Este mes hasta ahora: ${formatMoney(result.amountCents ?? 0)}. Ya está en el panel de Crecimiento.`)
        : t('No spend on that ad account this month yet.', 'Esa cuenta publicitaria aún no tiene gasto este mes.'),
      'success',
    )
  } catch (err: any) {
    showToast(err?.data?.statusMessage ?? t('Could not read the spend.', 'No se pudo leer el gasto.'), 'error')
  } finally {
    syncing.value = false
  }
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat(t('en-GB', 'es-ES'), { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

async function disconnect() {
  disconnecting.value = true
  try {
    await useStaffFetch('/api/meta/ads', { method: 'DELETE' })
    confirmingDisconnect.value = false
    showToast(t('Meta Ads disconnected.', 'Meta Ads desconectado.'), 'success')
    await load()
  } catch (err: any) {
    showToast(err?.data?.statusMessage ?? t('Could not disconnect.', 'No se pudo desconectar.'), 'error')
  } finally {
    disconnecting.value = false
  }
}

async function saveManual() {
  savingManual.value = true
  try {
    const { error } = await supabase.from('accounts').update({ meta_ads_account_id: manualId.value.trim().replace(/^act_/, '') || null }).eq('id', store.accountId!)
    if (error) throw new Error(error.message)
    if (manualToken.value.trim()) await useStaffFetch('/api/whatsapp/tokens', { method: 'PUT', body: { metaAds: manualToken.value.trim() } })
    manualToken.value = ''
    showToast(t('Saved', 'Guardado'))
    await load()
  } catch (err: any) {
    showToast(err?.data?.statusMessage ?? err?.message ?? t('Could not save.', 'No se pudo guardar.'), 'error')
  } finally {
    savingManual.value = false
  }
}

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <section aria-labelledby="h-meta-ads" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="meta-ads">
    <div class="flex flex-wrap items-start gap-4 px-[18px] pb-3.5 pt-4">
      <div class="min-w-[240px] flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h2 id="h-meta-ads" class="text-[16px] font-bold text-ink-900">{{ t('Meta Ads spend', 'Gasto en Meta Ads') }}</h2>
          <template v-if="!loading">
            <UiPill v-if="connected && !status?.error && !wrongCurrency" tone="success" dot data-cy="meta-ads-status">{{ t('Connected', 'Conectado') }}</UiPill>
            <UiPill v-else-if="connected" tone="warning" dot data-cy="meta-ads-status">{{ t('Needs attention', 'Requiere atención') }}</UiPill>
            <UiPill v-else tone="neutral" data-cy="meta-ads-status">{{ t('Not connected', 'Sin conectar') }}</UiPill>
          </template>
        </div>
        <p v-if="connected" class="mt-1 text-[14px] font-semibold text-ink-900" data-cy="meta-ads-account">
          {{ label }}<span v-if="status?.currency" class="ml-1 font-normal text-ink-muted2">· {{ status.currency }}</span>
        </p>
        <p v-if="connected && renewBy" class="mt-0.5 text-[12.5px]" :class="renewSoon ? 'font-semibold text-warning-text' : 'text-ink-muted2'" data-cy="meta-ads-renew">
          {{ t(`Meta asks for this connection to be renewed by ${renewByLabel}: click Reconnect before then.`, `Meta pide renovar esta conexión antes del ${renewByLabel}: pulsa Volver a conectar antes de esa fecha.`) }}
        </p>
        <p class="mt-1 text-[13px] leading-snug text-ink-muted">
          {{ t('Growth reads what you spent on Facebook and Instagram ads each month, so cost per lead and per new patient fill themselves in. Read-only: nothing here can create ads or spend money.', 'Crecimiento lee lo que gastaste en anuncios de Facebook e Instagram cada mes, para que el coste por lead y por paciente nuevo se rellenen solos. Solo lectura: nada aquí puede crear anuncios ni gastar dinero.') }}
        </p>
      </div>
      <div v-if="!loading" class="flex flex-wrap gap-2">
        <UiBtn v-if="connected" :disabled="syncing" data-cy="meta-ads-sync" @click="syncNow">{{ syncing ? t('Reading…', 'Leyendo…') : t('Read spend now', 'Leer gasto ahora') }}</UiBtn>
        <UiBtn v-if="meta.available.value" :variant="connected ? 'secondary' : 'primary'" :disabled="connecting" data-cy="meta-ads-connect" @click="connect">
          {{ connecting ? t('Connecting…', 'Conectando…') : connected ? t('Reconnect', 'Volver a conectar') : t('Connect Meta Ads', 'Conectar Meta Ads') }}
        </UiBtn>
        <UiBtn v-if="status?.adAccountId" variant="ghost" data-cy="meta-ads-disconnect" @click="confirmingDisconnect = true">{{ t('Disconnect', 'Desconectar') }}</UiBtn>
      </div>
    </div>

    <div v-if="choices.length" role="group" aria-labelledby="h-ads-choose" class="flex flex-col gap-2 border-t border-brand-tint bg-brand-tint px-[18px] py-3.5" data-cy="meta-ads-choices">
      <strong id="h-ads-choose" class="text-[14.5px] text-ink-900">{{ t('One more step: which ad account is this clinic’s?', 'Un paso más: ¿cuál es la cuenta publicitaria de esta clínica?') }}</strong>
      <p class="text-[13px] leading-snug text-ink-500">{{ t('Meta shared more than one ad account with QuiroFlow. Nothing is connected until you choose.', 'Meta ha compartido más de una cuenta publicitaria con QuiroFlow. No se conecta nada hasta que elijas.') }}</p>
      <div class="flex flex-wrap gap-2">
        <UiBtn v-for="c in choices" :key="c.adAccountId" variant="primary" :disabled="connecting" :data-ad-account-id="c.adAccountId" @click="pick(c.adAccountId)">
          {{ c.name ?? `act_${c.adAccountId}` }}<span v-if="c.currency" class="ml-1 font-normal opacity-80">· {{ c.currency }}</span>
        </UiBtn>
      </div>
    </div>

    <p v-if="wrongCurrency" class="border-t border-line-row px-[18px] py-2.5 text-[13px] leading-snug text-warning-text" data-cy="meta-ads-currency">
      {{ t(`This ad account bills in ${status?.currency}. QuiroFlow records spend in euros, so its spend has to be entered by hand on the Growth dashboard for now.`, `Esta cuenta publicitaria factura en ${status?.currency}. QuiroFlow registra el gasto en euros, así que de momento hay que introducirlo a mano en el panel de Crecimiento.`) }}
    </p>
    <p v-if="connectError || status?.error" role="alert" class="border-t border-line-row px-[18px] py-2.5 text-[13px] font-semibold text-danger-text" data-cy="meta-ads-error">
      {{ connectError || t(`Meta did not accept the stored token: ${status?.error}. Reconnect to fix it.`, `Meta no ha aceptado el token guardado: ${status?.error}. Vuelve a conectar para arreglarlo.`) }}
    </p>

    <details v-if="!loading && showManual" :open="!meta.available.value" class="group border-t border-line" data-cy="meta-ads-manual">
      <summary class="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-[18px] text-[13.5px] font-semibold text-ink-500 hover:bg-surface-subtle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transition-transform group-open:rotate-90"><path d="M9 6l6 6-6 6" /></svg>
        {{ t('Use a token of your own instead', 'Usar un token propio') }}
      </summary>
      <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
        <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
          <label for="ads-id" class="text-[14.5px] font-bold text-ink-900">{{ t('Ad account ID', 'ID de la cuenta publicitaria') }}</label>
          <span class="text-[13px] text-ink-500">{{ t('With or without act_. Euro accounts only for now.', 'Con o sin act_. De momento solo cuentas en euros.') }}</span>
        </div>
        <input id="ads-id" v-model="manualId" type="text" placeholder="act_1234567890" data-test="meta-ads-account-id" :class="[inputClass, 'w-full font-mono text-[13px] sm:w-[300px]']" />
      </div>
      <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
        <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
          <label for="ads-token" class="text-[14.5px] font-bold text-ink-900">{{ t('Read token', 'Token de lectura') }}</label>
          <span class="text-[13px] text-ink-500">{{ t('A long-lived token with ads_read for that account.', 'Un token de larga duración con ads_read para esa cuenta.') }}</span>
        </div>
        <input id="ads-token" v-model="manualToken" type="password" autocomplete="off" :placeholder="status?.hasToken ? '••••••••••••••••••••' : 'EAA…'" data-test="meta-ads-token" :class="[inputClass, 'w-full sm:w-[300px]']" />
      </div>
      <div class="flex justify-end border-t border-line-row px-[18px] py-3">
        <UiBtn variant="primary" :disabled="savingManual" data-test="meta-ads-save" @click="saveManual">{{ savingManual ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
      </div>
    </details>

    <UiConfirmDialog
      v-if="confirmingDisconnect"
      tone="danger"
      :title="t('Disconnect Meta Ads?', '¿Desconectar Meta Ads?')"
      :confirm-label="disconnecting ? t('Disconnecting…', 'Desconectando…') : t('Disconnect', 'Desconectar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="disconnecting"
      @confirm="disconnect"
      @cancel="confirmingDisconnect = false"
    >
      <p class="text-[13.5px] leading-snug text-ink-700">
        {{ t('Spend will stop being read in. What was already read stays on the Growth dashboard, and you can still type a month’s spend by hand.', 'El gasto dejará de leerse. Lo ya leído se queda en el panel de Crecimiento, y puedes seguir escribiendo el gasto de un mes a mano.') }}
      </p>
    </UiConfirmDialog>
  </section>
</template>
