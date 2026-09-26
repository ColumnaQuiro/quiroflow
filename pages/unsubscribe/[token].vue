<script setup lang="ts">
// Unsubscribe from a clinic's marketing email -- the link in the footer of
// every email an automation marked "comunicación comercial" sends. No login:
// whoever opens it is a patient or a lead with no QuiroFlow account, and the
// signed token in the URL (checked server-side) is all it takes. It asks
// before changing anything, because a link-scanning mail filter opens every
// link it sees and must not unsubscribe anybody by doing so.
//
// Spanish unless the browser prefers another language, in which case English.
definePageMeta({ layout: false })
useHead({ title: 'Darse de baja', meta: [{ name: 'robots', content: 'noindex' }] })

const route = useRoute()
const token = route.params.token as string

const phase = ref<'loading' | 'invalid' | 'ready' | 'working' | 'done' | 'already'>('loading')
const clinicName = ref<string | null>(null)
const error = ref(false)
const spanish = ref(true)

const copy = computed(() => {
  const clinic = clinicName.value || (spanish.value ? 'la clínica' : 'the clinic')
  return spanish.value
    ? {
        loading: 'Cargando…',
        invalid: 'Este enlace no es válido. Si quieres dejar de recibir emails, responde a cualquiera de ellos y la clínica te dará de baja.',
        title: '¿Darte de baja?',
        body: `Dejarás de recibir emails promocionales de ${clinic}. Los mensajes sobre tus citas (confirmaciones y recordatorios) seguirán llegando.`,
        button: 'Darme de baja',
        working: 'Un momento…',
        doneTitle: 'Te has dado de baja',
        doneBody: `No recibirás más emails promocionales de ${clinic}.`,
        alreadyTitle: 'Ya estabas dado de baja',
        alreadyBody: `No recibes emails promocionales de ${clinic}.`,
        failed: 'No se ha podido completar. Inténtalo de nuevo.',
      }
    : {
        loading: 'Loading…',
        invalid: 'This link is not valid. To stop receiving emails, reply to any of them and the clinic will take you off the list.',
        title: 'Unsubscribe?',
        body: `You will stop receiving promotional emails from ${clinic}. Messages about your appointments (confirmations and reminders) will still arrive.`,
        button: 'Unsubscribe me',
        working: 'One moment…',
        doneTitle: 'You have unsubscribed',
        doneBody: `You will not receive any more promotional emails from ${clinic}.`,
        alreadyTitle: 'You were already unsubscribed',
        alreadyBody: `You do not receive promotional emails from ${clinic}.`,
        failed: 'That did not work. Please try again.',
      }
})

onMounted(async () => {
  const lang = (navigator.languages?.[0] ?? navigator.language ?? 'es').toLowerCase()
  spanish.value = lang.startsWith('es') || lang.startsWith('ca') || lang.startsWith('gl') || lang.startsWith('eu')
  try {
    const info = await $fetch<{ clinicName: string | null; unsubscribed: boolean }>(`/api/unsubscribe/${encodeURIComponent(token)}`, {
      headers: { accept: 'application/json' },
    })
    clinicName.value = info.clinicName
    phase.value = info.unsubscribed ? 'already' : 'ready'
  } catch {
    phase.value = 'invalid'
  }
})

async function confirm() {
  phase.value = 'working'
  error.value = false
  try {
    const res = await $fetch<{ alreadyUnsubscribed: boolean }>(`/api/unsubscribe/${encodeURIComponent(token)}`, { method: 'POST' })
    phase.value = res.alreadyUnsubscribed ? 'already' : 'done'
  } catch {
    error.value = true
    phase.value = 'ready'
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-6 text-center shadow-card" data-cy="unsubscribe-card">
      <div v-if="phase === 'loading'" class="text-sm text-ink-faint">{{ copy.loading }}</div>

      <p v-else-if="phase === 'invalid'" class="text-sm text-danger-text" data-cy="unsubscribe-invalid">{{ copy.invalid }}</p>

      <template v-else-if="phase === 'ready' || phase === 'working'">
        <h1 class="text-lg font-semibold text-ink-900">{{ copy.title }}</h1>
        <p class="mt-2 text-sm text-ink-muted">{{ copy.body }}</p>
        <button
          type="button"
          data-cy="unsubscribe-confirm"
          class="mt-5 flex w-full items-center justify-center rounded-ctl bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          :disabled="phase === 'working'"
          @click="confirm"
        >
          {{ phase === 'working' ? copy.working : copy.button }}
        </button>
        <p v-if="error" class="mt-3 text-sm text-danger-text">{{ copy.failed }}</p>
      </template>

      <template v-else>
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-2xl text-success-text">✓</div>
        <h1 class="mt-4 text-lg font-semibold text-ink-900" data-cy="unsubscribe-done">{{ phase === 'done' ? copy.doneTitle : copy.alreadyTitle }}</h1>
        <p class="mt-2 text-sm text-ink-muted">{{ phase === 'done' ? copy.doneBody : copy.alreadyBody }}</p>
      </template>
    </div>
  </div>
</template>
