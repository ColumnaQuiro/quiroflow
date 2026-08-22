<script setup lang="ts">
import type { Tables } from '~/types/database.types'

type ApiToken = Tables<'api_tokens'>

const supabase = useSupabaseClient()
const store = useAccountStore()

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
    error.value = 'Give the token a name so you remember what it\'s for.'
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
  if (!confirm(`Revoke "${token.name}"? Anything using this token will stop working immediately.`)) return
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
  if (!iso) return 'Never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays}d ago`
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
    <PageHeader title="Developers" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[720px] flex-1 space-y-6">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            Tokens authenticate external tools (n8n, a script, another system) to send WhatsApp messages as this
            clinic without a QuiroFlow login. Treat a token like a password — anyone with it can send messages on
            your behalf.
          </p>

          <div v-if="justCreatedToken" class="rounded-card border border-warning-border bg-warning-bg p-4">
            <p class="text-[13px] font-semibold text-warning-text">Copy this token now — you won't see it again</p>
            <div class="mt-2 flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-ctlSm border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900">{{ justCreatedToken }}</code>
              <UiBtn variant="secondary" size="sm" @click="copyToken">{{ copied ? 'Copied!' : 'Copy' }}</UiBtn>
            </div>
            <button type="button" class="mt-2 text-[12px] text-ink-muted2 hover:text-ink-600" @click="justCreatedToken = null">Dismiss</button>
          </div>

          <div class="rounded-card border border-line bg-surface shadow-card">
            <div class="border-b border-line-divider p-4">
              <h3 class="text-[13.5px] font-[560] text-ink-700">API Tokens</h3>
            </div>
            <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">Loading…</div>
            <div v-else-if="tokens.length === 0" class="p-8 text-center text-[13px] text-ink-faint">No tokens yet.</div>
            <ul v-else class="divide-y divide-line-row">
              <li v-for="t in tokens" :key="t.id" class="flex items-center justify-between gap-3 p-4">
                <div class="min-w-0">
                  <p class="truncate text-[13.5px] font-[560] text-ink-700">{{ t.name }}</p>
                  <p class="mt-0.5 font-mono text-[12px] text-ink-muted2">{{ t.token_prefix }}…</p>
                  <p class="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-faint">
                    <UiPill v-for="s in t.scopes" :key="s" tone="brand">{{ s }}</UiPill>
                    <span>Last used: {{ relativeTime(t.last_used_at) }}</span>
                  </p>
                </div>
                <button type="button" class="shrink-0 text-[12.5px] font-medium text-danger-text hover:text-danger-text/80" @click="revokeToken(t)">
                  Revoke
                </button>
              </li>
            </ul>
          </div>

          <form class="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="createToken">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Token name</label>
              <input
                v-model="newTokenName"
                type="text"
                required
                placeholder="e.g. n8n WhatsApp automation"
                class="mt-1 h-8 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="creating">{{ creating ? 'Creating…' : 'Create Token' }}</UiBtn>
            <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
          </form>

          <div class="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 class="text-[13.5px] font-[560] text-ink-700">API Reference</h3>
            <p class="mt-2 text-[13px] leading-relaxed text-ink-muted2">
              One endpoint for now: send a WhatsApp message. Auth via
              <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5 text-[12px]">Authorization: Bearer &lt;token&gt;</code>.
            </p>

            <div class="mt-4">
              <div class="flex items-center gap-2">
                <UiPill tone="success">POST</UiPill>
                <code class="text-[13px] text-ink-900">/api/public/v1/whatsapp/send</code>
              </div>

              <p class="mt-3 text-[12.5px] font-medium text-ink-700">Body parameters</p>
              <table class="mt-1.5 w-full text-[12.5px]">
                <tbody class="divide-y divide-line-row">
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">to</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">E.164 phone number. Required unless <code>patientId</code> is given.</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">patientId</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">QuiroFlow patient id. Used to look up their number and enforce do-not-contact/under-age rules.</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">templateName</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">An approved WhatsApp template name. Works any time (see Settings &gt; WhatsApp for your approved templates).</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">templateLanguage</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">Defaults to "es".</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">variables</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string[]</td>
                    <td class="py-1.5 text-ink-muted2">Fills the template's {{1}}, {{2}}… placeholders in order.</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-3 font-mono text-ink-900">text</td>
                    <td class="py-1.5 pr-3 text-ink-muted2">string</td>
                    <td class="py-1.5 text-ink-muted2">Free-form text instead of a template. Only works within 24h of the recipient's last message to the clinic — a WhatsApp platform rule, not ours.</td>
                  </tr>
                </tbody>
              </table>

              <p class="mt-4 text-[12.5px] font-medium text-ink-700">Example — template send</p>
              <pre class="mt-1.5 overflow-x-auto rounded-ctl bg-ink-900 p-3 text-[12px] text-white"><code>{{ curlExample }}</code></pre>

              <p class="mt-4 text-[12.5px] font-medium text-ink-700">Example — free-form reply (within 24h window)</p>
              <pre class="mt-1.5 overflow-x-auto rounded-ctl bg-ink-900 p-3 text-[12px] text-white"><code>{{ curlFreeform }}</code></pre>

              <p class="mt-4 text-[12.5px] font-medium text-ink-700">Response</p>
              <pre class="mt-1.5 overflow-x-auto rounded-ctl bg-ink-900 p-3 text-[12px] text-white"><code>{{ '{ "success": true, "wamid": "wamid.HBg..." }' }}</code></pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
