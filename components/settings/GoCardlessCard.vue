<script setup lang="ts">
// Settings > Payments: memberships collected by SEPA Direct Debit through
// the clinic's OWN GoCardless account (server/api/gocardless/*).
//
// A clinic coming from PracticeHub usually has one already, with its
// patients' mandates in it: connecting the same account here is what lets
// QuiroFlow collect those memberships without anyone signing again. The
// mandates are matched to patients in Settings > Import.

const route = useRoute()
const t = useT()
const { showToast } = useToast()

interface Status {
  configured: boolean
  connected: boolean
  organisationId?: string | null
  environment?: 'live' | 'sandbox' | null
  verificationStatus?: string | null
  revokedElsewhere?: boolean
}

const status = ref<Status | null>(null)
const loading = ref(true)
const connectError = ref(typeof route.query.gocardless_error === 'string' ? route.query.gocardless_error : '')
const justConnected = ref(route.query.gocardless === 'connected')

async function load() {
  loading.value = true
  try {
    status.value = await useStaffFetch<Status>('/api/gocardless/status', { query: { refresh: '1' } })
  } catch {
    status.value = null
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  if (route.query.gocardless_error || route.query.gocardless) {
    const { gocardless: _a, gocardless_error: _b, ...rest } = route.query
    navigateTo({ path: route.path, query: rest }, { replace: true })
  }
})

// "successful" is the only state in which GoCardless pays out. The others
// mean the clinic still has something to finish in GoCardless itself.
const unverified = computed(() => status.value?.connected && status.value.verificationStatus && status.value.verificationStatus !== 'successful')

const disconnectOpen = ref(false)
const disconnecting = ref(false)
async function disconnect() {
  disconnecting.value = true
  try {
    await useStaffFetch('/api/gocardless/disconnect', { method: 'POST' })
    disconnectOpen.value = false
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('GoCardless is still connected.', 'GoCardless sigue conectado.'), 'error')
  } finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <section v-if="loading || status?.configured || status?.connected" aria-labelledby="h-gocardless" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="gocardless-section">
    <div class="flex items-start gap-3.5 px-[18px] py-4">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand-tint text-brand-text" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6" /></svg>
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2.5">
          <h2 id="h-gocardless" class="text-[16px] font-bold text-ink-900">{{ t('Direct debit with GoCardless', 'Domiciliación con GoCardless') }}</h2>
          <UiSkeleton v-if="loading" class="h-6 w-24 rounded-pill" />
          <UiPill v-else-if="unverified" tone="warning" dot data-cy="gocardless-status">{{ t('Pending verification', 'Pendiente de verificar') }}</UiPill>
          <UiPill v-else-if="status?.connected" tone="success" dot data-cy="gocardless-status">{{ t('Connected', 'Conectado') }}</UiPill>
          <UiPill v-else tone="neutral" data-cy="gocardless-status">{{ t('Not connected', 'Sin conectar') }}</UiPill>
          <UiPill v-if="status?.connected && status.environment === 'sandbox'" tone="neutral">{{ t('Test mode', 'Modo de prueba') }}</UiPill>
        </div>
        <p class="text-[13.5px] leading-snug text-ink-500">
          {{ t('Collects memberships from the patient’s bank account by SEPA direct debit. If your patients already pay you this way (for example through PracticeHub), connect the same GoCardless account and they will not have to sign again.', 'Cobra las membresías de la cuenta bancaria del paciente por domiciliación SEPA. Si tus pacientes ya te pagan así (por ejemplo, a través de PracticeHub), conecta la misma cuenta de GoCardless y no tendrán que volver a firmar.') }}
        </p>
      </div>
    </div>

    <div v-if="justConnected" class="mx-[18px] mb-3 rounded-ctl border border-success-border bg-success-bg px-3 py-2.5 text-[13px] text-success-deep" data-cy="gocardless-connected">
      {{ t('GoCardless account connected. Next, match your patients’ direct debits in Settings › Import.', 'Cuenta de GoCardless conectada. Ahora empareja las domiciliaciones de tus pacientes en Ajustes › Importar.') }}
    </div>
    <div v-if="connectError" class="mx-[18px] mb-3 rounded-ctl border border-danger-border bg-danger-bg px-3 py-2.5 text-[13px] text-danger-text" data-cy="gocardless-error">{{ connectError }}</div>
    <div v-if="status?.revokedElsewhere" class="mx-[18px] mb-3 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] text-warning-text">
      {{ t('QuiroFlow was disconnected from your GoCardless dashboard. Connect again to keep collecting.', 'QuiroFlow se desconectó desde tu panel de GoCardless. Vuelve a conectar para seguir cobrando.') }}
    </div>
    <div v-if="unverified" class="mx-[18px] mb-3 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] text-warning-text" data-cy="gocardless-unverified">
      {{ t('GoCardless has not verified this account yet, so it cannot collect. Finish the steps it asks for in your GoCardless dashboard.', 'GoCardless todavía no ha verificado esta cuenta, así que no puede cobrar. Completa los pasos que te pide en tu panel de GoCardless.') }}
    </div>

    <template v-if="!loading && status">
      <div v-if="status.connected" class="flex flex-wrap items-center gap-3 border-t border-line-row px-[18px] py-3">
        <span class="text-[13px] text-ink-muted">{{ t('Organisation', 'Organización') }}</span>
        <code class="rounded-ctlSm bg-surface-page px-2 py-1 font-mono text-[12.5px] text-ink-500">{{ status.organisationId }}</code>
        <span class="flex-1" />
        <NuxtLink to="/settings/import?source=practicehub&type=gocardless" class="inline-flex h-9 touch:h-11 items-center rounded-ctl border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink-900 hover:bg-surface-subtle" data-cy="gocardless-import-link">
          {{ t('Match direct debits', 'Emparejar domiciliaciones') }}
        </NuxtLink>
        <UiBtn class="!border-danger-border !text-danger-text" data-cy="gocardless-disconnect" @click="disconnectOpen = true">{{ t('Disconnect', 'Desconectar') }}</UiBtn>
      </div>
      <div v-else class="flex flex-wrap items-center gap-3 border-t border-line-row px-[18px] py-3">
        <span class="flex-1 text-[13.5px] text-ink-700">{{ t('Sign in to your GoCardless account, or create one.', 'Inicia sesión en tu cuenta de GoCardless o crea una.') }}</span>
        <a href="/api/gocardless/connect/start?signup=1" class="text-[13px] font-semibold text-brand-text hover:underline" data-cy="gocardless-signup">{{ t('I don’t have one', 'No tengo cuenta') }}</a>
        <a href="/api/gocardless/connect/start" data-cy="gocardless-connect" class="inline-flex h-9 touch:h-11 items-center rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover">
          {{ t('Connect GoCardless', 'Conectar GoCardless') }}
        </a>
      </div>
    </template>

    <UiConfirmDialog
      v-if="disconnectOpen"
      tone="danger"
      :title="t('Disconnect GoCardless?', '¿Desconectar GoCardless?')"
      :confirm-label="disconnecting ? t('Disconnecting…', 'Desconectando…') : t('Disconnect', 'Desconectar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="disconnect"
      @cancel="disconnectOpen = false"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        {{ t('Your patients’ mandates are not touched, so nobody has to sign again. But direct debits QuiroFlow set up keep collecting in GoCardless, and QuiroFlow will no longer record those payments. Cancel them first if that is what you want.', 'Las domiciliaciones de tus pacientes no se tocan, así que nadie tendrá que volver a firmar. Pero los cobros que QuiroFlow programó siguen cobrándose en GoCardless y QuiroFlow dejará de registrarlos. Cancélalos antes si es lo que quieres.') }}
      </p>
    </UiConfirmDialog>
  </section>
</template>
