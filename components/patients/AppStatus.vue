<script setup lang="ts">
import { formatRelativeDays } from '~/utils/billing'
import { appInviteText } from '~/utils/appInvite'

// Whether this patient has the app, in the banner's contact row: the front
// desk's question is "do they have it, or do I send them the link?", and
// until now the answer was only a count of devices in Settings > App.
//
// Three states, from what the database actually knows:
//  - app: a device ran the app signed in as them (app_opens.user_id, filled
//    by record_app_open since 20261020072746). Shows the platform and when.
//  - account: they have a login (patients.user_id) but no device is linked
//    to it yet. That is the web portal, or a phone that hasn't opened the
//    app since the migration, so it doesn't claim "never opened".
//  - none: no login. Offers the invite, ready to paste into a chat.
const props = defineProps<{
  patientId: string
  userId: string | null
  firstName: string | null
  preferredLanguage: string | null
  canContact: boolean
}>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { preference } = useLang()

const device = ref<{ platform: string; last_seen_at: string } | null>(null)
const loaded = ref(false)

watch(
  () => [props.userId, store.accountId] as const,
  async ([userId, accountId]) => {
    device.value = null
    loaded.value = false
    if (!userId || !accountId) {
      loaded.value = true
      return
    }
    const { data } = await supabase
      .from('app_opens')
      .select('platform, last_seen_at')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Each patient lookup is its own question; a slow answer for the previous
    // record must not land on this one.
    if (userId !== props.userId) return
    device.value = data
    loaded.value = true
  },
  { immediate: true },
)

const state = computed<'app' | 'account' | 'none'>(() => (device.value ? 'app' : props.userId ? 'account' : 'none'))

const PLATFORM: Record<string, string> = { ios: 'iPhone', android: 'Android', web: 'Web' }

const label = computed(() => {
  if (state.value === 'app' && device.value) {
    const when = formatRelativeDays(device.value.last_seen_at, preference.value === 'es' ? 'es' : 'en')
    return `${t('App', 'App')} · ${PLATFORM[device.value.platform] ?? device.value.platform} · ${t('opened', 'abierta')} ${when}`
  }
  if (state.value === 'account') return t('Has an app account', 'Tiene cuenta en la app')
  return t('No app', 'Sin app')
})

const copied = ref(false)
async function copyInvite() {
  const text = appInviteText({
    firstName: props.firstName,
    clinicName: store.accountName,
    code: store.accountSlug,
    language: props.preferredLanguage,
  })
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    // Clipboard blocked: nothing on screen to select instead, so say so.
    useToast().showToast(t('Could not copy. Settings > App has the links and the code.', 'No se pudo copiar. En Ajustes > App están los enlaces y el código.'), 'error')
  }
}
</script>

<template>
  <span v-if="loaded" class="inline-flex items-center gap-1.5" data-cy="patient-app-status" :data-state="state">
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0" :class="state === 'none' ? 'text-ink-faint' : 'text-brand-text'">
      <rect x="4.2" y="1.8" width="7.6" height="12.4" rx="1.6" stroke="currentColor" stroke-width="1.3" />
      <path d="M7 12h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
    <span class="text-[12.5px]" :class="state === 'none' ? 'text-ink-muted' : 'text-ink-500'">{{ label }}</span>
    <button
      v-if="state === 'none' && canContact && store.accountSlug"
      type="button"
      class="text-[12px] font-semibold text-brand-text outline-none hover:underline focus-visible:underline"
      data-cy="patient-app-invite"
      @click="copyInvite"
    >
      {{ t('Copy invite', 'Copiar invitación') }}
    </button>
    <span v-if="copied" class="text-[11.5px] text-success-text">{{ t('Copied, paste it in a chat', 'Copiada, pégala en un chat') }}</span>
  </span>
</template>
