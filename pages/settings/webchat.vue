<script setup lang="ts">
// A chat button on the clinic's own website (public/webchat.js), answered
// from the Inbox -- and by the AI receptionist when it is on. Addressed by
// the booking page's slug, so it needs one before there is a snippet to copy.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const loading = ref(true)
const saving = ref(false)
const enabled = ref(false)
const greeting = ref('')
const slug = ref('')

// Set only after mount: an origin read during SSR would differ from the
// client's first render, and Vue flags that as a hydration mismatch.
const appOrigin = ref('')
onMounted(() => (appOrigin.value = window.location.origin))

// The closing tag is split: written whole, it would end this <script setup>.
const snippet = computed(() => (slug.value && appOrigin.value ? `<script src="${appOrigin.value}/webchat.js" data-clinic="${slug.value}" async><` + `/script>` : ''))

async function load() {
  const { data } = await supabase.from('accounts').select('webchat_enabled, webchat_greeting, slug').eq('id', store.accountId!).maybeSingle()
  enabled.value = data?.webchat_enabled ?? false
  greeting.value = data?.webchat_greeting ?? ''
  slug.value = data?.slug ?? ''
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  const { error } = await supabase
    .from('accounts')
    .update({ webchat_enabled: enabled.value, webchat_greeting: greeting.value.trim() || null })
    .eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Saved', 'Guardado'))
}

async function copy() {
  try {
    await navigator.clipboard.writeText(snippet.value)
    showToast(t('Copied. Paste it before </body> on every page of your website.', 'Copiado. Pégalo antes de </body> en todas las páginas de tu web.'), 'success')
  } catch {
    showToast(t('Could not copy. Select the code and copy it by hand.', 'No se pudo copiar. Selecciona el código y cópialo a mano.'), 'error')
  }
}

const inputClass = 'rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Website chat', 'Chat en tu web')">
      <UiBtn variant="primary" data-cy="webchat-save" :disabled="saving || loading" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="webchat-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('A chat button on your website. Each visitor who writes becomes a lead, their messages arrive in the Inbox, and the AI receptionist answers them if it is on.', 'Un botón de chat en tu web. Cada visitante que escribe se convierte en lead, sus mensajes llegan a la Bandeja y la recepcionista con IA le contesta si está activada.') }}
          </p>

          <UiSkeleton v-if="loading" class="h-56 w-full rounded-card" />
          <section v-else aria-labelledby="h-webchat" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex items-start gap-4 px-[18px] pb-3.5 pt-4">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 id="h-webchat" class="text-[16px] font-bold text-ink-900">{{ t('Show the chat on my website', 'Mostrar el chat en mi web') }}</h2>
                  <UiPill v-if="enabled" tone="success" dot>{{ t('On', 'Activado') }}</UiPill>
                  <UiPill v-else tone="neutral">{{ t('Off', 'Desactivado') }}</UiPill>
                </div>
                <p class="mt-1 text-[13px] leading-snug text-ink-muted">{{ t('Off hides it everywhere, even where the code is still pasted.', 'Desactivado lo oculta en todas partes, aunque el código siga pegado.') }}</p>
              </div>
              <SettingsToggle v-model="enabled" aria-labelledby="h-webchat" data-cy="webchat-enabled" />
            </div>
            <div class="flex flex-wrap items-start gap-4 border-t border-line-row px-[18px] py-3">
              <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                <label for="webchat-greeting" class="text-[14.5px] font-bold text-ink-900">{{ t('Greeting', 'Saludo') }}</label>
                <span class="text-[13px] text-ink-500">{{ t('The first thing a visitor reads when they open the chat.', 'Lo primero que lee un visitante al abrir el chat.') }}</span>
              </div>
              <textarea id="webchat-greeting" v-model="greeting" rows="2" maxlength="300" data-cy="webchat-greeting" :placeholder="t('Hi! How can we help you?', '¡Hola! ¿En qué te podemos ayudar?')" :class="[inputClass, 'w-full sm:w-[340px]']" />
            </div>
            <div class="flex flex-col gap-2 border-t border-line-row px-[18px] py-3.5">
              <span class="text-[14.5px] font-bold text-ink-900">{{ t('Code for your website', 'Código para tu web') }}</span>
              <template v-if="snippet">
                <span class="text-[13px] text-ink-500">{{ t('Paste it once, before </body>, on every page. Whoever manages your website can do it in a minute.', 'Pégalo una vez, antes de </body>, en todas las páginas. Quien lleve tu web lo hace en un minuto.') }}</span>
                <div class="flex flex-wrap items-center gap-2">
                  <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-ctl border border-line bg-surface-subtle px-3 py-2 font-mono text-[12.5px] text-ink-700" data-cy="webchat-snippet">{{ snippet }}</code>
                  <UiBtn data-cy="webchat-copy" @click="copy">{{ t('Copy', 'Copiar') }}</UiBtn>
                </div>
              </template>
              <span v-else class="text-[13px] text-ink-500">
                {{ t('Your clinic needs a booking page address first. Set it in', 'Primero tu clínica necesita una dirección de reservas. Ponla en') }}
                <NuxtLink to="/settings/online-booking" class="font-semibold text-brand-text hover:underline">{{ t('Online booking', 'Reserva online') }}</NuxtLink>.
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
