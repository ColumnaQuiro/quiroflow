<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { API_BASE_URL } from '~/utils/apiContract'
import { DEV_PORTAL_ORIGIN } from '~/utils/devPortal'

type ApiToken = Tables<'api_tokens'>
type RequestLog = Tables<'api_request_logs'>

const supabase = useSupabaseClient()
const t = useT()
const { showToast } = useToast()

const tokens = ref<ApiToken[]>([])
const loading = ref(true)
const logs = ref<RequestLog[]>([])
const logsLoading = ref(true)

const panelOpen = ref(false)
const justCreatedToken = ref<string | null>(null)

async function load() {
  const { data } = await supabase.from('api_tokens').select('*').is('revoked_at', null).order('created_at', { ascending: false })
  tokens.value = data ?? []
  loading.value = false
}

async function loadLogs() {
  logsLoading.value = true
  const { data } = await supabase.from('api_request_logs').select('*').order('created_at', { ascending: false }).limit(30)
  logs.value = data ?? []
  logsLoading.value = false
}

onMounted(() => {
  load()
  loadLogs()
})

async function onCreated(raw: string) {
  panelOpen.value = false
  justCreatedToken.value = raw
  copied.value = false
  await load()
}

// Asked in an in-app dialog rather than confirm().
const revoking = ref<ApiToken | null>(null)
async function confirmRevoke() {
  const token = revoking.value
  if (!token) return
  const { error } = await supabase.from('api_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', token.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  revoking.value = null
  await load()
}

const copied = ref(false)
async function copyToken() {
  if (!justCreatedToken.value) return
  await navigator.clipboard.writeText(justCreatedToken.value)
  copied.value = true
}

function relativeTime(iso: string | null) {
  if (!iso) return t('Never', 'Nunca')
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (diffDays === 0) return t('Today', 'Hoy')
  if (diffDays === 1) return t('Yesterday', 'Ayer')
  return t(`${diffDays} days ago`, `hace ${diffDays} días`)
}

function isExpired(token: ApiToken) {
  return !!token.expires_at && new Date(token.expires_at) <= new Date()
}

function tokenName(id: string | null) {
  return tokens.value.find((tk) => tk.id === id)?.name ?? t('revoked token', 'token revocado')
}

function statusTone(status: number) {
  if (status < 300) return 'success'
  if (status < 500) return 'warning'
  return 'danger'
}

const curlExample = `curl "${API_BASE_URL}/appointments?starts_at=gte:2026-03-01T00:00:00Z" \\
  -H "Authorization: Bearer qf_live_..."`
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('API & Tokens', 'API y tokens')">
      <a :href="DEV_PORTAL_ORIGIN" target="_blank" rel="noopener" class="inline-flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover touch:h-11">
        {{ t('API docs', 'Documentación') }} ↗
      </a>
      <UiBtn variant="primary" data-cy="token-new" @click="panelOpen = true">{{ t('New token', 'Nuevo token') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[980px] flex-1 flex-col gap-4" data-cy="developers-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t("Tokens let other software (n8n, a booking widget, an AI receptionist, your own scripts) read and write this clinic's data without a QuiroFlow login. Treat one like a password.", 'Los tokens permiten que otro software (n8n, un widget de reservas, un recepcionista con IA, tus propios scripts) lea y escriba los datos de esta clínica sin iniciar sesión en QuiroFlow. Trátalo como una contraseña.') }}
          </p>

          <!-- Just created: shown once -->
          <section v-if="justCreatedToken" role="status" class="flex flex-col gap-2.5 rounded-card border border-success-border bg-success-bg px-[18px] py-4" data-cy="token-created">
            <strong class="text-[14.5px] text-ink-900">{{ t('Copy the token now; it is not shown again.', 'Copia el token ahora; no se vuelve a mostrar.') }}</strong>
            <div class="flex flex-col gap-2 sm:flex-row">
              <code class="flex h-9 min-w-0 flex-1 items-center truncate rounded-ctl border border-success-border bg-surface px-3 font-mono text-[13px] text-ink-900" data-cy="token-raw">{{ justCreatedToken }}</code>
              <UiBtn variant="primary" data-cy="token-copy" @click="copyToken">{{ copied ? t('Copied', 'Copiado') : t('Copy', 'Copiar') }}</UiBtn>
              <UiBtn @click="justCreatedToken = null">{{ t('Done', 'Hecho') }}</UiBtn>
            </div>
          </section>

          <section aria-labelledby="h-tokens" class="overflow-hidden rounded-card border border-line bg-surface">
            <h2 id="h-tokens" class="px-[18px] pb-2.5 pt-4 text-[16px] font-bold text-ink-900">{{ t('Tokens', 'Tokens') }}<span v-if="!loading"> · {{ tokens.length }}</span></h2>
            <div v-if="loading" class="flex flex-col gap-2 border-t border-line-row p-[18px]">
              <UiSkeleton v-for="i in 2" :key="i" class="h-4 w-full max-w-md rounded-ctlSm" />
            </div>
            <p v-else-if="tokens.length === 0" class="border-t border-line-row px-[18px] py-8 text-center text-[13.5px] text-ink-muted">{{ t('No tokens yet. Create one for each integration, so each can be revoked on its own.', 'Aún no hay tokens. Crea uno por integración, para poder revocar cada uno por separado.') }}</p>
            <div v-else class="overflow-x-auto">
              <table class="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr class="border-y border-line text-left text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-faint">
                    <th class="py-2 pl-[18px] pr-3.5 font-semibold">{{ t('Name', 'Nombre') }}</th>
                    <th class="px-3.5 py-2 font-semibold">{{ t('Can', 'Puede') }}</th>
                    <th class="px-3.5 py-2 font-semibold">{{ t('Last used', 'Último uso') }}</th>
                    <th class="px-3.5 py-2 font-semibold">{{ t('Expires', 'Caduca') }}</th>
                    <th class="py-2 pr-[18px]"><span class="sr-only">{{ t('Actions', 'Acciones') }}</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="tk in tokens" :key="tk.id" class="border-b border-line-row align-middle last:border-b-0" data-cy="token-row">
                    <td class="py-2.5 pl-[18px] pr-3.5">
                      <div class="flex flex-col gap-0.5">
                        <strong class="text-[14px] font-semibold text-ink-900">{{ tk.name }}</strong>
                        <span class="font-mono text-[12px] text-ink-muted">{{ tk.token_prefix }}…</span>
                        <span v-if="tk.app_name" class="text-[12px] text-ink-muted">{{ tk.app_name }}<template v-if="tk.app_contact"> · {{ tk.app_contact }}</template></span>
                      </div>
                    </td>
                    <td class="px-3.5 py-2.5">
                      <div class="flex max-w-[300px] flex-wrap gap-1">
                        <UiPill v-for="s in tk.scopes" :key="s" tone="brand">{{ s }}</UiPill>
                      </div>
                    </td>
                    <td class="whitespace-nowrap px-3.5 py-2.5 text-[13px]" :class="tk.last_used_at ? 'text-ink-700' : 'text-warning-text'">{{ relativeTime(tk.last_used_at) }}</td>
                    <td class="whitespace-nowrap px-3.5 py-2.5 text-[13px] text-ink-muted">
                      <UiPill v-if="isExpired(tk)" tone="danger">{{ t('Expired', 'Caducado') }}</UiPill>
                      <template v-else>{{ tk.expires_at ? new Date(tk.expires_at).toLocaleDateString('es-ES') : t('Never', 'Nunca') }}</template>
                    </td>
                    <td class="py-2.5 pr-[18px] text-right">
                      <UiBtn size="sm" class="!border-danger-border !text-danger-text" data-cy="token-revoke" @click="revoking = tk">{{ t('Revoke', 'Revocar') }}</UiBtn>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="h-activity" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex items-start gap-4 px-[18px] pb-2.5 pt-4">
              <div class="flex-1">
                <h2 id="h-activity" class="text-[16px] font-bold text-ink-900">{{ t('Recent requests', 'Solicitudes recientes') }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">{{ t("The last 30 calls made with this clinic's tokens.", 'Las últimas 30 llamadas hechas con los tokens de esta clínica.') }}</p>
              </div>
              <UiBtn size="sm" @click="loadLogs">{{ t('Refresh', 'Actualizar') }}</UiBtn>
            </div>
            <div v-if="logsLoading" class="flex flex-col gap-2 border-t border-line-row p-[18px]">
              <UiSkeleton v-for="i in 4" :key="i" class="h-3.5 w-full rounded-ctlSm" />
            </div>
            <p v-else-if="logs.length === 0" class="border-t border-line-row px-[18px] py-8 text-center text-[13.5px] text-ink-muted">{{ t('No API requests yet.', 'Todavía no hay solicitudes de API.') }}</p>
            <div v-else class="overflow-x-auto">
              <table class="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr class="border-y border-line text-left text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-faint">
                    <th class="py-2 pl-[18px] pr-3.5 font-semibold">{{ t('When', 'Cuándo') }}</th>
                    <th class="px-3.5 py-2 font-semibold">{{ t('Request', 'Solicitud') }}</th>
                    <th class="px-3.5 py-2 font-semibold">{{ t('Result', 'Resultado') }}</th>
                    <th class="py-2 pl-3.5 pr-[18px] font-semibold">{{ t('Token', 'Token') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="log in logs" :key="log.id" class="border-b border-line-row align-top last:border-b-0">
                    <td class="whitespace-nowrap py-2.5 pl-[18px] pr-3.5 text-[13px] text-ink-muted">{{ new Date(log.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) }}</td>
                    <td class="px-3.5 py-2.5">
                      <p class="break-all font-mono text-[12.5px] text-ink-900"><strong class="font-semibold">{{ log.method }}</strong> {{ log.path }}</p>
                      <p v-if="log.error_message" class="mt-0.5 text-[12px] leading-snug text-danger-text">{{ log.error_message }}</p>
                    </td>
                    <td class="whitespace-nowrap px-3.5 py-2.5">
                      <UiPill :tone="statusTone(log.status_code)">{{ log.status_code }}</UiPill>
                      <span v-if="log.duration_ms" class="ml-1.5 text-[12px] text-ink-faint">{{ log.duration_ms }} ms</span>
                    </td>
                    <td class="py-2.5 pl-3.5 pr-[18px] text-[13px] text-ink-700">{{ tokenName(log.token_id) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <details class="overflow-hidden rounded-card border border-line bg-surface" :open="!loading && tokens.length === 0">
            <summary class="cursor-pointer px-[18px] py-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle">{{ t('Quick start', 'Inicio rápido') }}</summary>
            <div class="flex flex-col gap-2.5 px-[18px] pb-4 text-[13px] leading-snug text-ink-700">
              <p>{{ t('Send the token as a bearer header. The base URL is the same for every clinic; the token decides which one you act for.', 'Envía el token en la cabecera Authorization. La URL base es la misma para todas las clínicas; el token decide en nombre de cuál actúas.') }}</p>
              <pre class="overflow-x-auto rounded-ctl bg-[rgb(21,23,30)] p-3 text-[12px] text-[rgb(236,238,243)]"><code>{{ curlExample }}</code></pre>
            </div>
          </details>
        </div>
      </div>
    </div>

    <SettingsNewTokenPanel v-if="panelOpen" @created="onCreated" @close="panelOpen = false" />

    <UiConfirmDialog
      v-if="revoking"
      tone="danger"
      :title="t(`Revoke “${revoking.name}”?`, `¿Revocar «${revoking.name}»?`)"
      :confirm-label="t('Revoke token', 'Revocar token')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmRevoke"
      @cancel="revoking = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('Anything using it stops working at once, and it cannot be turned back on. A new token would have to be set up in its place.', 'Todo lo que lo use deja de funcionar al momento, y no se puede reactivar. Habría que configurar un token nuevo en su lugar.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
