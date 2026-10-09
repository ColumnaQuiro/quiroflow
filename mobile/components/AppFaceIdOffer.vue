<script setup lang="ts">
// Once per person and device, after signing in (and once after updating, for
// people already signed in): "¿Quieres usar Face ID para entrar?". Saying no
// is remembered until they sign out; Profile / Cuenta switch it either way.
// Not while signing in or on the two-factor step, nor in reception mode,
// where the iPad is in a patient's hands.
const t = useT()
const route = useRoute()
const lock = useAppLock()
const supabase = useSupabaseClient()
const user = useSupabaseUser()

const open = ref(false)
const busy = ref(false)
const QUIET = ['/login', '/signup', '/join', '/forgot-password']

async function consider() {
  if (!lock.native() || !lock.ready.value || lock.enabled.value || !lock.biometry.value || lock.locked.value) return
  const userId = user.value?.sub
  if (!userId || lock.offered(userId)) return
  if (QUIET.includes(route.path) || route.path.startsWith('/reception')) return
  // Past two-factor, not in the middle of it.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return
  open.value = true
}
watch(() => [user.value?.sub, route.path, lock.ready.value, lock.locked.value], () => setTimeout(consider, 800), { immediate: true })

function close() {
  const userId = user.value?.sub
  if (userId) lock.markOffered(userId)
  open.value = false
}
async function activate() {
  busy.value = true
  await lock.enable()
  busy.value = false
  close()
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 md:items-center" data-cy="faceid-offer">
    <div class="w-full max-w-md rounded-t-[20px] bg-surface px-5 pb-6 pt-5 text-center shadow-popover md:rounded-[20px]" style="padding-bottom: max(env(safe-area-inset-bottom), 1.5rem)">
      <p class="text-[17px] font-semibold text-ink-900">{{ t(`Use ${lock.label.value} to get in?`, `¿Quieres usar ${lock.label.value} para entrar?`) }}</p>
      <p class="mt-1.5 text-[13.5px] leading-snug text-ink-muted">
        {{ t(`You stay signed in. When you open QuiroFlow after more than two hours, we'll ask for ${lock.label.value} instead of your password.`, `Seguirás con la sesión iniciada. Cuando abras QuiroFlow después de más de dos horas, te pediremos ${lock.label.value} en lugar de la contraseña.`) }}
      </p>
      <button type="button" class="mt-5 min-h-11 w-full rounded-ctl bg-brand px-4 text-[15px] font-semibold text-white" :disabled="busy" data-cy="faceid-offer-yes" @click="activate">
        {{ t(`Turn on ${lock.label.value}`, `Activar ${lock.label.value}`) }}
      </button>
      <button type="button" class="mt-2 min-h-11 w-full px-4 text-[14px] font-medium text-ink-muted" :disabled="busy" data-cy="faceid-offer-no" @click="close">
        {{ t('Not now', 'Ahora no') }}
      </button>
      <p class="mt-1 text-[11.5px] text-ink-faint">{{ t('You can change it any time in your profile.', 'Puedes cambiarlo cuando quieras en tu perfil.') }}</p>
    </div>
  </div>
</template>
