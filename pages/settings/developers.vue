<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { API_BASE_URL, API_SCOPES } from '~/utils/apiContract'
import { DEV_PORTAL_ORIGIN } from '~/utils/devPortal'

type ApiToken = Tables<'api_tokens'>
type RequestLog = Tables<'api_request_logs'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const tokens = ref<ApiToken[]>([])
const loading = ref(true)

const newTokenName = ref('')
const appName = ref('')
const appContact = ref('')
const selectedScopes = ref<string[]>([])
const expiresInDays = ref('')
const creating = ref(false)
const error = ref('')
const justCreatedToken = ref<string | null>(null)

const logs = ref<RequestLog[]>([])
const logsLoading = ref(true)

// Grouped exactly as the portal's Authentication page groups them, from the
// same list the server authorises against.
const scopeGroups = computed(() => {
  const groups = new Map<string, (typeof API_SCOPES)[number][]>()
  for (const scope of API_SCOPES) groups.set(scope.group, [...(groups.get(scope.group) ?? []), scope])
  return [...groups.entries()]
})

async function load() {
  loading.value = true
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

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Generated entirely client-side: the raw token is shown to the user once
// and never sent anywhere except in this one insert (as a hash) -- the
// server only ever sees and stores the sha256 digest, never the raw value.
async function createToken() {
  error.value = ''
  if (!newTokenName.value.trim()) {
    error.value = t("Give the token a name so you remember what it's for.", 'Ponle un nombre al token para recordar para qué sirve.')
    return
  }
  if (selectedScopes.value.length === 0) {
    error.value = t('Select at least one scope. A token with no scopes cannot call anything.', 'Selecciona al menos un permiso. Un token sin permisos no puede llamar a nada.')
    return
  }
  creating.value = true

  const randomBytes = crypto.getRandomValues(new Uint8Array(24))
  const raw = `qf_live_${toHex(randomBytes.buffer)}`
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))

  const days = Number(expiresInDays.value)
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null

  const { error: insertError } = await supabase.from('api_tokens').insert({
    account_id: store.accountId!,
    name: newTokenName.value.trim(),
    token_hash: toHex(hashBuffer),
    token_prefix: raw.slice(0, 16),
    scopes: [...selectedScopes.value],
    app_name: appName.value.trim() || null,
    app_contact: appContact.value.trim() || null,
    expires_at: expiresAt,
    created_by: store.teamMember?.id ?? null,
  })

  creating.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  newTokenName.value = ''
  appName.value = ''
  appContact.value = ''
  selectedScopes.value = []
  expiresInDays.value = ''
  justCreatedToken.value = raw
  await load()
}

async function revokeToken(token: ApiToken) {
  if (!confirm(t(`Revoke "${token.name}"? Anything using this token stops working immediately.`, `¿Revocar "${token.name}"? Cualquier cosa que use este token dejará de funcionar de inmediato.`))) return
  await supabase.from('api_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', token.id)
  await load()
}

const copied = ref(false)
async function copyToken() {
  if (!justCreatedToken.value) return
  await navigator.clipboard.writeText(justCreatedToken.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

function relativeTime(iso: string | null) {
  if (!iso) return t('Never', 'Nunca')
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (diffDays === 0) return t('Today', 'Hoy')
  if (diffDays === 1) return t('Yesterday', 'Ayer')
  return t(`${diffDays}d ago`, `hace ${diffDays}d`)
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
    <PageHeader :title="t('Developers', 'Desarrolladores')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[720px] flex-1 space-y-6">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{ t('Tokens let external software (n8n, a booking widget, an AI receptionist, your own scripts) read and write this clinic\'s data without a QuiroFlow login. Treat a token like a password — anyone holding it can act as this clinic.', 'Los tokens permiten que software externo (n8n, un widget de reservas, un recepcionista con IA, tus propios scripts) lea y escriba los datos de esta clínica sin iniciar sesión en QuiroFlow. Trata un token como una contraseña: cualquiera que lo tenga puede actuar en nombre de esta clínica.') }}
          </p>

          <div class="rounded-card border border-brand-tintBorder bg-brand-tint p-4">
            <p class="text-[13px] font-[560] text-brand-text">{{ t('API documentation', 'Documentación de la API') }}</p>
            <p class="mt-1 text-[12.5px] leading-relaxed text-brand-text2">
              {{ t('Every endpoint, with examples, filtering, pagination, webhooks and error codes.', 'Todos los endpoints, con ejemplos, filtrado, paginación, webhooks y códigos de error.') }}
            </p>
            <a :href="DEV_PORTAL_ORIGIN" target="_blank" rel="noopener" class="mt-2 inline-block text-[12.5px] font-semibold text-brand-text underline">developers.quiroflow.com →</a>
          </div>

          <div v-if="justCreatedToken" class="rounded-card border border-warning-border bg-warning-bg p-4">
            <p class="text-[13px] font-semibold text-warning-text">{{ t("Copy this token now — you won't see it again", 'Copia este token ahora — no volverás a verlo') }}</p>
            <div class="mt-2 flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-ctlSm border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900">{{ justCreatedToken }}</code>
              <UiBtn variant="secondary" size="sm" @click="copyToken">{{ copied ? t('Copied!', '¡Copiado!') : t('Copy', 'Copiar') }}</UiBtn>
            </div>
            <button type="button" class="mt-2 text-[12px] text-ink-muted2 hover:text-ink-600" @click="justCreatedToken = null">{{ t('Dismiss', 'Descartar') }}</button>
          </div>

          <!-- Tokens -->
          <div class="rounded-card border border-line bg-surface shadow-card">
            <div class="border-b border-line-divider p-4">
              <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('API Tokens', 'Tokens de API') }}</h3>
            </div>
            <div v-if="loading" class="divide-y divide-line-row">
              <div v-for="i in 2" :key="i" class="space-y-2 p-4">
                <UiSkeleton class="h-3.5 w-32 rounded-ctlSm" />
                <UiSkeleton class="h-3 w-48 rounded-ctlSm" />
              </div>
            </div>
            <div v-else-if="tokens.length === 0" class="p-8 text-center text-[13px] text-ink-faint">{{ t('No tokens yet.', 'Todavía no hay tokens.') }}</div>
            <ul v-else class="divide-y divide-line-row">
              <li v-for="tk in tokens" :key="tk.id" class="flex items-start justify-between gap-3 p-4">
                <div class="min-w-0">
                  <p class="flex items-center gap-2 truncate text-[13.5px] font-[560] text-ink-700">
                    {{ tk.name }}
                    <UiPill v-if="isExpired(tk)" tone="danger">{{ t('Expired', 'Caducado') }}</UiPill>
                  </p>
                  <p v-if="tk.app_name" class="mt-0.5 text-[12px] text-ink-muted2">
                    {{ tk.app_name }}<span v-if="tk.app_contact"> · {{ tk.app_contact }}</span>
                  </p>
                  <p class="mt-0.5 font-mono text-[12px] text-ink-muted2">{{ tk.token_prefix }}…</p>
                  <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <UiPill v-for="s in tk.scopes" :key="s" tone="brand">{{ s }}</UiPill>
                  </div>
                  <p class="mt-1.5 text-[11.5px] text-ink-faint">
                    {{ t('Last used:', 'Último uso:') }} {{ relativeTime(tk.last_used_at) }}
                    <span v-if="tk.expires_at"> · {{ t('Expires', 'Caduca') }} {{ new Date(tk.expires_at).toLocaleDateString() }}</span>
                  </p>
                </div>
                <button type="button" class="shrink-0 text-[12.5px] font-medium text-danger-text hover:text-danger-text/80" @click="revokeToken(tk)">
                  {{ t('Revoke', 'Revocar') }}
                </button>
              </li>
            </ul>
          </div>

          <!-- Create -->
          <form class="space-y-4 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="createToken">
            <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('Create a token', 'Crear un token') }}</h3>

            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Token name', 'Nombre del token') }}</label>
                <input
                  v-model="newTokenName"
                  type="text"
                  required
                  :placeholder="t('e.g. Booking widget', 'p. ej. Widget de reservas')"
                  class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">
                  {{ t('Expires after', 'Caduca en') }}
                  <span class="font-normal text-ink-faint">({{ t('optional', 'opcional') }})</span>
                </label>
                <select
                  v-model="expiresInDays"
                  class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                >
                  <option value="">{{ t('Never', 'Nunca') }}</option>
                  <option value="30">{{ t('30 days', '30 días') }}</option>
                  <option value="90">{{ t('90 days', '90 días') }}</option>
                  <option value="365">{{ t('1 year', '1 año') }}</option>
                </select>
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">
                  {{ t('Integration name', 'Nombre de la integración') }}
                  <span class="font-normal text-ink-faint">({{ t('optional', 'opcional') }})</span>
                </label>
                <input
                  v-model="appName"
                  type="text"
                  placeholder="Acme Booking"
                  class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">
                  {{ t('Developer contact', 'Contacto del desarrollador') }}
                  <span class="font-normal text-ink-faint">({{ t('optional', 'opcional') }})</span>
                </label>
                <input
                  v-model="appContact"
                  type="email"
                  placeholder="dev@example.com"
                  class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
            </div>

            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Scopes', 'Permisos') }}</label>
              <p class="mt-0.5 text-[11.5px] leading-relaxed text-ink-faint">
                {{ t('Grant only what the integration needs. A token that cannot read invoices cannot leak them.', 'Concede solo lo que la integración necesite. Un token que no puede leer facturas no puede filtrarlas.') }}
              </p>
              <div class="mt-2 space-y-3">
                <div v-for="[group, scopes] in scopeGroups" :key="group">
                  <p class="text-[11px] font-[640] uppercase tracking-[.06em] text-ink-faint">{{ group }}</p>
                  <div class="mt-1 space-y-1">
                    <label v-for="scope in scopes" :key="scope.key" class="flex items-start gap-2 text-[12.5px] text-ink-600">
                      <input
                        v-model="selectedScopes"
                        type="checkbox"
                        :value="scope.key"
                        class="mt-0.5 rounded border-line-control text-brand focus:ring-brand/30"
                      />
                      <span>
                        <code class="font-mono text-[12px] text-ink-900">{{ scope.key }}</code>
                        <span class="ml-1.5 text-ink-muted2">{{ t(scope.en, scope.es) }}</span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <UiBtn variant="primary" type="submit" :disabled="creating">{{ creating ? t('Creating…', 'Creando…') : t('Create Token', 'Crear token') }}</UiBtn>
            <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
          </form>

          <!-- Usage -->
          <div class="rounded-card border border-line bg-surface shadow-card">
            <div class="flex items-center justify-between border-b border-line-divider p-4">
              <div>
                <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('Recent API activity', 'Actividad reciente de la API') }}</h3>
                <p class="mt-0.5 text-[12px] text-ink-faint">{{ t('The last 30 requests made with this clinic\'s tokens.', 'Las últimas 30 solicitudes hechas con los tokens de esta clínica.') }}</p>
              </div>
              <button type="button" class="text-[12.5px] font-medium text-ink-muted2 hover:text-ink-700" @click="loadLogs">{{ t('Refresh', 'Actualizar') }}</button>
            </div>
            <div v-if="logsLoading" class="space-y-2 p-4">
              <UiSkeleton v-for="i in 4" :key="i" class="h-3.5 w-full rounded-ctlSm" />
            </div>
            <div v-else-if="logs.length === 0" class="p-8 text-center text-[13px] text-ink-faint">
              {{ t('No API requests yet.', 'Todavía no hay solicitudes de API.') }}
            </div>
            <ul v-else class="divide-y divide-line-row">
              <li v-for="log in logs" :key="log.id" class="flex items-start gap-3 px-4 py-2.5 text-[12.5px]">
                <UiPill :tone="statusTone(log.status_code)">{{ log.status_code }}</UiPill>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-mono text-[12px] text-ink-900">{{ log.method }} {{ log.path }}</p>
                  <p v-if="log.error_message" class="mt-0.5 text-[11.5px] leading-snug text-danger-text">{{ log.error_message }}</p>
                  <p class="mt-0.5 text-[11.5px] text-ink-faint">
                    {{ tokenName(log.token_id) }} · {{ new Date(log.created_at).toLocaleString() }}
                    <span v-if="log.duration_ms"> · {{ log.duration_ms }}ms</span>
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <div class="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('Quick start', 'Inicio rápido') }}</h3>
            <p class="mt-2 text-[13px] leading-relaxed text-ink-muted2">
              {{ t('Send the token as an Authorization header. The base URL is the same for every clinic — which clinic you act for is decided by the token.', 'Envía el token en la cabecera Authorization. La URL base es la misma para todas las clínicas: el token decide en nombre de qué clínica actúas.') }}
            </p>
            <pre class="mt-3 overflow-x-auto rounded-ctl bg-[rgb(21,23,30)] p-3 text-[12px] text-[rgb(236,238,243)]"><code>{{ curlExample }}</code></pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
