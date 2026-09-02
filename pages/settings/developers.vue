<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type ApiToken = Tables<'api_tokens'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const tokens = ref<ApiToken[]>([])
const loading = ref(true)

const newTokenName = ref('')
const creating = ref(false)
const error = ref('')
const justCreatedToken = ref<string | null>(null)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('api_tokens')
    .select('*')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  tokens.value = data ?? []
  loading.value = false
}
onMounted(load)

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Generated entirely client-side: the raw token is shown to the user once
// and never sent anywhere except in this one insert (as a hash) -- the
// server only ever sees and stores the sha256 digest, never the raw value.
async function createToken() {
  error.value = ''
  if (!newTokenName.value.trim()) {
    error.value = t('Give the token a name so you remember what it\'s for.', 'Ponle un nombre al token para recordar para qué sirve.')
    return
  }
  creating.value = true

  const randomBytes = crypto.getRandomValues(new Uint8Array(24))
  const raw = `qf_live_${toHex(randomBytes.buffer)}`
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hash = toHex(hashBuffer)
  const prefix = raw.slice(0, 16)

  const { error: insertError } = await supabase.from('api_tokens').insert({
    account_id: store.accountId!,
    name: newTokenName.value.trim(),
    token_hash: hash,
    token_prefix: prefix,
    scopes: ['whatsapp:send'],
    created_by: store.teamMember?.id ?? null,
  })

  creating.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  newTokenName.value = ''
  justCreatedToken.value = raw
  await load()
}

async function revokeToken(token: ApiToken) {
  if (!confirm(t(`Revoke "${token.name}"? Anything using this token will stop working immediately.`, `¿Revocar "${token.name}"? Cualquier cosa que use este token dejará de funcionar de inmediato.`))) return
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
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return t('Today', 'Hoy')
  if (diffDays === 1) return t('Yesterday', 'Ayer')
  return t(`${diffDays}d ago`, `hace ${diffDays}d`)
}

const curlExample = computed(() => `curl -X POST https://app.quiroflow.com/api/public/v1/whatsapp/send \\
  -H "Authorization: Bearer qf_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+34612345678",
    "templateName": "appointment_reminder",
    "templateLanguage": "es",
    "variables": ["Maria"]
  }'`)

const curlFreeform = computed(() => `curl -X POST https://app.quiroflow.com/api/public/v1/whatsapp/send \\
  -H "Authorization: Bearer qf_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "patientId": "6f2b1e2a-....",
    "text": "Gracias por tu mensaje, te confirmamos la cita."
  }'`)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Developers', 'Desarrolladores')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[720px] flex-1 space-y-6">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{ t('Tokens authenticate external tools (n8n, a script, another system) to send WhatsApp messages as this clinic without a QuiroFlow login. Treat a token like a password — anyone with it can send messages on your behalf.', 'Los tokens autentican herramientas externas (n8n, un script, otro sistema) para enviar mensajes de WhatsApp en nombre de esta clínica sin iniciar sesión en QuiroFlow. Trata un token como una contraseña — cualquiera que lo tenga puede enviar mensajes en tu nombre.') }}
          </p>

          <div v-if="justCreatedToken" class="rounded-card border border-warning-border bg-warning-bg p-4">
            <p class="text-[13px] font-semibold text-warning-text">{{ t("Copy this token now — you won't see it again", 'Copia este token ahora — no volverás a verlo') }}</p>
            <div class="mt-2 flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-ctlSm border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900">{{ justCreatedToken }}</code>
              <UiBtn variant="secondary" size="sm" @click="copyToken">{{ copied ? t('Copied!', '¡Copiado!') : t('Copy', 'Copiar') }}</UiBtn>
            </div>
            <button type="button" class="mt-2 text-[12px] text-ink-muted2 hover:text-ink-600" @click="justCreatedToken = null">{{ t('Dismiss', 'Descartar') }}</button>
          </div>

          <div class="rounded-card border border-line bg-surface shadow-card">
            <div class="border-b border-line-divider p-4">
              <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('API Tokens', 'Tokens de API') }}</h3>
            </div>
            <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
            <div v-else-if="tokens.length === 0" class="p-8 text-center text-[13px] text-ink-faint">{{ t('No tokens yet.', 'Todavía no hay tokens.') }}</div>
            <ul v-else class="divide-y divide-line-row">
              <li v-for="tk in tokens" :key="tk.id" class="flex items-center justify-between gap-3 p-4">
                <div class="min-w-0">
                  <p class="truncate text-[13.5px] font-[560] text-ink-700">{{ tk.name }}</p>
                  <p class="mt-0.5 font-mono text-[12px] text-ink-muted2">{{ tk.token_prefix }}…</p>
                  <p class="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-faint">
                    <UiPill v-for="s in tk.scopes" :key="s" tone="brand">{{ s }}</UiPill>
                    <span>{{ t('Last used:', 'Último uso:') }} {{ relativeTime(tk.last_used_at) }}</span>
                  </p>
                </div>
                <button type="button" class="shrink-0 text-[12.5px] font-medium text-danger-text hover:text-danger-text/80" @click="revokeToken(tk)">
                  {{ t('Revoke', 'Revocar') }}
                </button>
              </li>
            </ul>
          </div>

          <form class="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="createToken">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Token name', 'Nombre del token') }}</label>
              <input
                v-model="newTokenName"
                type="text"
                required
                :placeholder="t('e.g. n8n WhatsApp automation', 'p. ej. automatización de WhatsApp con n8n')"
                class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="creating">{{ creating ? t('Creating…', 'Creando…') : t('Create Token', 'Crear token') }}</UiBtn>
            <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
          </form>

          <div class="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('API Reference', 'Referencia de la API') }}</h3>
            <p class="mt-2 text-[13px] leading-relaxed text-ink-muted2">
              {{ t('One endpoint for now: send a WhatsApp message. Auth via', 'Por ahora, un único endpoint: enviar un mensaje de WhatsApp. Autenticación mediante') }}
              <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5 text-[12px]">Authorization: Bearer &lt;token&gt;</code>.
            </p>

            <div class="mt-4">
              <div class="flex items-center gap-2">
                <UiPill tone="success">POST</UiPill>
                <code class="text-[13px] text-ink-900">/api/public/v1/whatsapp/send</code>
              </div>

              <p class="mt-3 text-[12.5px] font-medium text-ink-700">{{ t('Body parameters', 'Parámetros del cuerpo') }}</p>
              <table class="mt-1.5 w-full text-[12.5px]">
                <tbody class="divide-y divide-line-row">
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">to</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">{{ t('E.164 phone number. Required unless', 'Número de teléfono en formato E.164. Obligatorio salvo que se indique') }} <code>patientId</code>{{ t('.', '.') }}</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">patientId</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">{{ t("QuiroFlow patient id. Used to look up their number and enforce do-not-contact/under-age rules.", 'Id de paciente de QuiroFlow. Se usa para localizar su número y aplicar las reglas de no-contactar/menor de edad.') }}</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">templateName</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">{{ t('An approved WhatsApp template name. Works any time (see Settings > WhatsApp for your approved templates).', 'El nombre de una plantilla de WhatsApp aprobada. Funciona en cualquier momento (consulta Ajustes > WhatsApp para ver tus plantillas aprobadas).') }}</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">templateLanguage</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">{{ t('Defaults to "es".', 'Por defecto es "es".') }}</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">variables</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string[]</td>
                    <td class="py-1.5 text-ink-muted2">{{ t("Fills the template's {{1}}, {{2}}… placeholders in order.", 'Rellena los marcadores {{1}}, {{2}}… de la plantilla en orden.') }}</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">text</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">{{ t("Free-form text instead of a template. Only works within 24h of the recipient's last message to the clinic — a WhatsApp platform rule, not ours.", 'Texto libre en lugar de una plantilla. Solo funciona dentro de las 24h posteriores al último mensaje del destinatario a la clínica — es una regla de la plataforma de WhatsApp, no nuestra.') }}</td>
                  </tr>
                </tbody>
              </table>

              <p class="mt-4 text-[12.5px] font-medium text-ink-700">{{ t('Example — template send', 'Ejemplo — envío de plantilla') }}</p>
              <pre class="mt-1.5 overflow-x-auto rounded-ctl bg-ink-900 p-3 text-[12px] text-white"><code>{{ curlExample }}</code></pre>

              <p class="mt-4 text-[12.5px] font-medium text-ink-700">{{ t('Example — free-form reply (within 24h window)', 'Ejemplo — respuesta de texto libre (dentro de la ventana de 24h)') }}</p>
              <pre class="mt-1.5 overflow-x-auto rounded-ctl bg-ink-900 p-3 text-[12px] text-white"><code>{{ curlFreeform }}</code></pre>

              <p class="mt-4 text-[12.5px] font-medium text-ink-700">{{ t('Response', 'Respuesta') }}</p>
              <pre class="mt-1.5 overflow-x-auto rounded-ctl bg-ink-900 p-3 text-[12px] text-white"><code>{{ '{ "success": true, "wamid": "wamid.HBg..." }' }}</code></pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
