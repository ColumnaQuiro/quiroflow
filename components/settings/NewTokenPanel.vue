<script setup lang="ts">
// Settings > API & Tokens: making a token, in a side panel over the page
// rather than a form at the bottom of it. Emits the raw token once; the page
// shows it for copying and it is never readable again.
import { API_SCOPES } from '~/utils/apiContract'

const emit = defineEmits<{ created: [raw: string]; close: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))

const name = ref('')
const appName = ref('')
const appContact = ref('')
const selectedScopes = ref<string[]>([])
const expiresInDays = ref('')
const creating = ref(false)
const error = ref('')

// Grouped exactly as the portal's Authentication page groups them, from the
// same list the server authorises against.
const scopeGroups = computed(() => {
  const groups = new Map<string, (typeof API_SCOPES)[number][]>()
  for (const scope of API_SCOPES) groups.set(scope.group, [...(groups.get(scope.group) ?? []), scope])
  return [...groups.entries()]
})

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Generated entirely client-side: the raw token is shown to the user once
// and never sent anywhere except in this one insert (as a hash) -- the
// server only ever sees and stores the sha256 digest, never the raw value.
async function create() {
  error.value = ''
  if (!name.value.trim()) {
    error.value = t("Give the token a name so you remember what it's for.", 'Ponle un nombre al token para recordar para qué sirve.')
    return
  }
  if (selectedScopes.value.length === 0) {
    error.value = t('Choose at least one thing it can do. A token with no scopes cannot call anything.', 'Elige al menos una cosa que pueda hacer. Un token sin permisos no puede llamar a nada.')
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
    name: name.value.trim(),
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
  emit('created', raw)
}

const inputClass = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end bg-ink-900/30" @click.self="emit('close')">
    <form
      ref="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-token-title"
      data-cy="token-panel"
      class="flex h-full w-full max-w-[460px] flex-col bg-surface shadow-popover"
      @submit.prevent="create"
    >
      <div class="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <h2 id="new-token-title" class="text-[16px] font-bold text-ink-900">{{ t('New token', 'Nuevo token') }}</h2>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="flex h-9 w-9 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Name', 'Nombre') }}
          <input v-model="name" type="text" data-autofocus data-cy="token-name" :placeholder="t('e.g. Booking widget', 'p. ej. Widget de reservas')" :class="inputClass" />
        </label>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Expires', 'Caduca') }}
          <select v-model="expiresInDays" data-cy="token-expires" :class="inputClass">
            <option value="">{{ t('Never', 'Nunca') }}</option>
            <option value="30">{{ t('In 30 days', 'En 30 días') }}</option>
            <option value="90">{{ t('In 90 days', 'En 90 días') }}</option>
            <option value="365">{{ t('In a year', 'En un año') }}</option>
          </select>
        </label>
        <fieldset class="flex flex-col gap-2.5">
          <legend class="mb-1 text-[13px] font-semibold text-ink-700">{{ t('What it can do', 'Qué puede hacer') }}</legend>
          <p class="-mt-1 text-[12.5px] leading-snug text-ink-muted">{{ t('Only what the integration needs. A token that cannot read receipts cannot leak them.', 'Solo lo que necesite la integración. Un token que no puede leer recibos no puede filtrarlos.') }}</p>
          <div v-for="[group, scopes] in scopeGroups" :key="group" class="flex flex-col gap-1.5 rounded-ctl border border-line-row px-3 py-2.5">
            <strong class="text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ group }}</strong>
            <label v-for="scope in scopes" :key="scope.key" class="flex items-start gap-2 text-[13.5px] text-ink-700">
              <input v-model="selectedScopes" type="checkbox" :value="scope.key" data-cy="token-scope" class="mt-0.5 h-4 w-4 rounded border-line-control text-brand focus:ring-brand/30" />
              <span>{{ t(scope.en, scope.es) }} <code class="ml-1 font-mono text-[11.5px] text-ink-faint">{{ scope.key }}</code></span>
            </label>
          </div>
        </fieldset>
        <details>
          <summary class="cursor-pointer text-[13px] font-semibold text-ink-muted">{{ t('Who built it (optional)', 'Quién lo ha hecho (opcional)') }}</summary>
          <div class="mt-2.5 flex flex-col gap-2.5">
            <input v-model="appName" type="text" :placeholder="t('Integration name', 'Nombre de la integración')" :aria-label="t('Integration name', 'Nombre de la integración')" :class="inputClass" />
            <input v-model="appContact" type="email" :placeholder="t('Developer contact', 'Contacto del desarrollador')" :aria-label="t('Developer contact', 'Contacto del desarrollador')" :class="inputClass" />
          </div>
        </details>
        <p v-if="error" class="text-[13px] text-danger-text" data-cy="token-error">{{ error }}</p>
      </div>
      <div class="flex justify-end gap-2 border-t border-line px-5 py-3.5">
        <UiBtn @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn variant="primary" type="submit" data-cy="token-create" :disabled="creating">{{ creating ? t('Creating…', 'Creando…') : t('Create token', 'Crear token') }}</UiBtn>
      </div>
    </form>
  </div>
</template>
