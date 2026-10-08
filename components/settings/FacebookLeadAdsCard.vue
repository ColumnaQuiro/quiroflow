<script setup lang="ts">
// Facebook lead ads, received by QuiroFlow itself. The clinic signs in with
// Meta, ticks the Page its lead ads run on, and every form submission on that
// Page lands on Growth › Leads -- and starts whatever lead.created automation
// is switched on -- within seconds. Nothing to build in n8n or Zapier.
//
// Each Page shows how it is actually doing, not just that it is connected: a
// connection that has stopped delivering looks exactly like a quiet week
// otherwise, and that is the failure this card exists to make visible.

interface LeadAdPageRow {
  page_id: string
  page_name: string | null
  form_submission_is_consent: boolean
  connected_at: string
  last_lead_at: string | null
  last_synced_at: string | null
  last_error: string | null
  last_error_at: string | null
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()
const { available, launch } = useFacebookPageConnect()

const pages = ref<LeadAdPageRow[]>([])
const loading = ref(true)
const connecting = ref(false)
const syncing = ref<string | null>(null)
const disconnecting = ref<LeadAdPageRow | null>(null)
const disconnectBusy = ref(false)

async function load() {
  const { data } = await supabase
    .from('lead_ad_pages')
    .select('page_id, page_name, form_submission_is_consent, connected_at, last_lead_at, last_synced_at, last_error, last_error_at')
    .eq('account_id', store.accountId!)
    .order('connected_at')
  pages.value = (data ?? []) as LeadAdPageRow[]
  loading.value = false
}
onMounted(load)

function when(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// An error is only worth showing while it is the latest thing that happened:
// a lead filed or a sweep completed after it means the Page has recovered.
function currentError(page: LeadAdPageRow) {
  if (!page.last_error || !page.last_error_at) return null
  const recovered = [page.last_lead_at, page.last_synced_at].some((at) => at && at > page.last_error_at!)
  return recovered ? null : page.last_error
}

async function connect() {
  connecting.value = true
  try {
    const code = await launch()
    const result = await useStaffFetch<{ connected: { id: string; name: string | null }[]; refused: { name: string | null; id: string; reason: string }[] }>('/api/meta/lead-pages/connect', {
      method: 'POST',
      body: { code },
    })
    const names = result.connected.map((p) => p.name ?? p.id).join(', ')
    showToast(t(`Connected: ${names}.`, `Conectado: ${names}.`), 'success')
    for (const r of result.refused) showToast(`${r.name ?? r.id}: ${r.reason}`, 'error')
    await load()
  } catch (err: any) {
    // Closing Meta's dialog is not a failure (see WhatsAppConnectCard).
    if (err?.message === 'CANCELLED') return
    showToast(err?.data?.statusMessage ?? err?.message ?? t('Could not connect the Page.', 'No se pudo conectar la página.'), 'error')
  } finally {
    connecting.value = false
  }
}

async function setConsent(page: LeadAdPageRow, value: boolean) {
  const before = page.form_submission_is_consent
  page.form_submission_is_consent = value
  try {
    await useStaffFetch(`/api/meta/lead-pages/${page.page_id}`, { method: 'PATCH', body: { formSubmissionIsConsent: value } })
  } catch (err: any) {
    page.form_submission_is_consent = before
    showToast(err?.data?.statusMessage ?? t('Could not save.', 'No se pudo guardar.'), 'error')
  }
}

async function syncNow(page: LeadAdPageRow) {
  syncing.value = page.page_id
  try {
    const result = await useStaffFetch<{ filed: number }>(`/api/meta/lead-pages/${page.page_id}/sync`, { method: 'POST' })
    showToast(
      result.filed
        ? t(`${result.filed} missed lead(s) added.`, `${result.filed} lead(s) que faltaban añadido(s).`)
        : t('Up to date — no missed leads.', 'Al día — no faltaba ningún lead.'),
      'success',
    )
  } catch (err: any) {
    showToast(err?.data?.statusMessage ?? t('Could not reach Facebook.', 'No se pudo contactar con Facebook.'), 'error')
  } finally {
    syncing.value = null
    await load()
  }
}

async function disconnect() {
  const page = disconnecting.value
  if (!page) return
  disconnectBusy.value = true
  try {
    await useStaffFetch(`/api/meta/lead-pages/${page.page_id}`, { method: 'DELETE' })
    showToast(t('Page disconnected.', 'Página desconectada.'), 'success')
    disconnecting.value = null
    await load()
  } catch (err: any) {
    showToast(err?.data?.statusMessage ?? t('Could not disconnect.', 'No se pudo desconectar.'), 'error')
  } finally {
    disconnectBusy.value = false
  }
}
</script>

<template>
  <section aria-labelledby="h-fb-leads" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="facebook-lead-ads">
    <div class="flex items-start gap-4 px-[18px] pb-3.5 pt-4">
      <div class="min-w-0 flex-1">
        <h2 id="h-fb-leads" class="text-[16px] font-bold text-ink-900">{{ t('Facebook & Instagram lead ads', 'Anuncios de clientes potenciales de Facebook e Instagram') }}</h2>
        <p class="mt-1 text-[13px] leading-snug text-ink-muted">
          {{
            t(
              'Connect the Facebook Page your lead ads run on. Every form submission arrives here within seconds and starts your new-lead automations.',
              'Conecta la página de Facebook en la que publicas tus anuncios de clientes potenciales. Cada formulario enviado llega aquí en segundos y pone en marcha tus automatizaciones de nuevos leads.',
            )
          }}
        </p>
      </div>
      <UiBtn v-if="available" variant="primary" :disabled="connecting" data-cy="facebook-lead-ads-connect" @click="connect">
        {{ connecting ? t('Connecting…', 'Conectando…') : pages.length ? t('Add a Page', 'Añadir página') : t('Connect', 'Conectar') }}
      </UiBtn>
    </div>

    <p v-if="!available && !loading && !pages.length" class="border-t border-line-row px-[18px] py-3 text-[13px] text-ink-muted2">
      {{ t('Not available on this deployment yet.', 'Aún no disponible en esta instalación.') }}
    </p>

    <div v-for="page in pages" :key="page.page_id" class="border-t border-line-row px-[18px] py-3.5" :data-page-id="page.page_id" data-cy="facebook-lead-page">
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-[220px] flex-1">
          <p class="text-[14.5px] font-bold text-ink-900">{{ page.page_name ?? page.page_id }}</p>
          <p class="mt-0.5 text-[12.5px] text-ink-muted2">
            <template v-if="page.last_lead_at">{{ t('Last lead', 'Último lead') }}: {{ when(page.last_lead_at) }}</template>
            <template v-else>{{ t('No leads yet since connecting', 'Aún no ha llegado ningún lead desde que se conectó') }}</template>
            <template v-if="page.last_synced_at"> · {{ t('checked', 'revisado') }} {{ when(page.last_synced_at) }}</template>
          </p>
          <p v-if="currentError(page)" class="mt-1 text-[12.5px] leading-snug text-danger-text" data-cy="facebook-lead-page-error">{{ currentError(page) }}</p>
        </div>
        <div class="flex gap-2">
          <UiBtn size="sm" :disabled="syncing === page.page_id" data-cy="facebook-lead-page-sync" @click="syncNow(page)">
            {{ syncing === page.page_id ? t('Checking…', 'Revisando…') : t('Fetch missed leads', 'Buscar leads perdidos') }}
          </UiBtn>
          <UiBtn size="sm" variant="ghost" data-cy="facebook-lead-page-disconnect" @click="disconnecting = page">{{ t('Disconnect', 'Desconectar') }}</UiBtn>
        </div>
      </div>
      <div class="mt-3 flex items-start gap-3">
        <SettingsToggle :model-value="page.form_submission_is_consent" data-cy="facebook-lead-page-consent" @update:model-value="(v: boolean) => setConsent(page, v)" />
        <p class="text-[13px] leading-snug text-ink-500">
          {{
            t(
              "Sending the form counts as consent to marketing messages, for forms without their own consent checkbox. Only switch this on if your form's privacy text says so. A form with a checkbox always uses the person's answer.",
              'Enviar el formulario cuenta como consentimiento para mensajes comerciales, en formularios sin casilla de consentimiento propia. Actívalo solo si el texto de privacidad de tu formulario lo indica. Un formulario con casilla siempre usa la respuesta de la persona.',
            )
          }}
        </p>
      </div>
    </div>

    <UiConfirmDialog
      v-if="disconnecting"
      tone="danger"
      :title="t('Disconnect this Page?', '¿Desconectar esta página?')"
      :confirm-label="disconnectBusy ? t('Disconnecting…', 'Desconectando…') : t('Disconnect', 'Desconectar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="disconnectBusy"
      @confirm="disconnect"
      @cancel="disconnecting = null"
    >
      <p class="text-[13.5px] leading-snug text-ink-700">
        {{
          t(
            `New leads from ${disconnecting.page_name ?? 'this Page'} will stop arriving in QuiroFlow. Leads already here stay.`,
            `Los nuevos leads de ${disconnecting.page_name ?? 'esta página'} dejarán de llegar a QuiroFlow. Los que ya están aquí se quedan.`,
          )
        }}
      </p>
    </UiConfirmDialog>
  </section>
</template>
