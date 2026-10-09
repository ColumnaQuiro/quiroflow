<script setup lang="ts">
// Covers the whole app while it is locked (composables/useAppLock.ts) and
// asks for Face ID straight away, as a bank's app does on opening. Nothing of
// the clinic or the patient shows behind it: it is opaque, and above every
// sheet. "Usar contraseña" is a normal sign-in, and forgets Face ID on this
// device -- on a shared iPad the next person's password must not leave the
// previous one's face as the key.
const t = useT()
const lock = useAppLock()
const supabase = useSupabaseClient()
const failed = ref(false)

async function tryUnlock() {
  failed.value = !(await lock.unlock())
}
watch(
  () => lock.locked.value,
  (on) => {
    if (on) {
      failed.value = false
      // A beat for the screen to draw before the system sheet covers it.
      setTimeout(tryUnlock, 250)
    }
  },
  { immediate: true },
)

async function usePassword() {
  await lock.forget()
  clearVisitNoteDrafts()
  await supabase.auth.signOut({ scope: 'local' })
  await navigateTo('/login')
}
</script>

<template>
  <div v-if="lock.locked.value" class="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface-page px-8 text-center" style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom)" role="dialog" aria-modal="true" data-cy="app-lock">
    <img src="/logo/quiroflow-app-icon.svg" alt="" class="h-16 w-16 rounded-[18px]" />
    <p class="mt-5 text-[19px] font-[640] tracking-tightTitle text-ink-900">QuiroFlow</p>
    <p class="mt-1.5 text-[13.5px] text-ink-muted">{{ t(`Unlock with ${lock.label.value} to continue.`, `Desbloquea con ${lock.label.value} para continuar.`) }}</p>
    <button type="button" class="mt-7 min-h-11 w-full max-w-xs rounded-ctl bg-brand px-4 text-[15px] font-semibold text-white" data-cy="app-lock-unlock" @click="tryUnlock">
      {{ t(`Use ${lock.label.value}`, `Usar ${lock.label.value}`) }}
    </button>
    <p v-if="failed" role="alert" class="mt-3 text-[12.5px] text-ink-muted">{{ t("It didn't work. Try again, or use your password.", 'No ha funcionado. Inténtalo de nuevo o usa tu contraseña.') }}</p>
    <button type="button" class="mt-4 min-h-11 px-4 text-[14px] font-medium text-brand-text" data-cy="app-lock-password" @click="usePassword">
      {{ t('Use password', 'Usar contraseña') }}
    </button>
  </div>
</template>
