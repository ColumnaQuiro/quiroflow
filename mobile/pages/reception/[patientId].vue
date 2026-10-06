<script setup lang="ts">
// Reception mode (canvas: AppIpadReception): the iPad in a patient's hands,
// showing their forms one after another and nothing else. Each one is read
// and saved through get/save_public_patient_doc with its public token -- the
// same two functions the link a patient gets by WhatsApp uses -- so what is
// signed here lands on the record exactly as a signed link does (answers
// only, the stored blocks kept, linked fields copied back to the record).
//
// The route is the only one reachable while the lock is on
// (middleware/reception.global.ts). Leaving is ReceptionExit's job.
import type { DocField } from '../../../utils/docFields'

definePageMeta({ layout: false })

const supabase = useSupabaseClient()
const t = useT()
const reception = useReceptionLock()
const lock = ref(reception.current())
if (!lock.value) navigateTo('/', { replace: true })

const index = ref(0)
const phase = ref<'loading' | 'fill' | 'done'>('loading')
const title = ref('')
const fields = ref<DocField[]>([])
const saving = ref(false)
const error = ref('')
const exitOpen = ref(false)
const topEl = ref<HTMLElement | null>(null)
const total = computed(() => lock.value?.tokens.length ?? 0)

async function loadCurrent() {
  error.value = ''
  const token = lock.value?.tokens[index.value]
  if (!token) {
    phase.value = 'done'
    return
  }
  phase.value = 'loading'
  const { data, error: e } = await supabase.rpc('get_public_patient_doc' as never, { p_token: token } as never)
  const doc = data as { title: string | null; fields: DocField[]; completed_at: string | null } | null
  // Already signed (from the link, or on another device): on to the next.
  if (e || !doc || doc.completed_at) {
    index.value++
    return loadCurrent()
  }
  title.value = doc.title ?? ''
  fields.value = Array.isArray(doc.fields) ? doc.fields : []
  phase.value = 'fill'
  // The page scrolls inside the app's root box (app.vue), not the window, so
  // window.scrollTo did nothing and the next form opened halfway down.
  await nextTick()
  topEl.value?.scrollIntoView({ block: 'start' })
}
onMounted(loadCurrent)

const empty = (v: DocField['value']) => v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)
async function submit() {
  const missing = fields.value.find((f) => f.required && !['heading', 'text'].includes(f.type) && empty(f.value))
  if (missing) {
    error.value = t(`Still missing: ${missing.label}`, `Falta: ${missing.label}`)
    return
  }
  saving.value = true
  error.value = ''
  const { error: e } = await supabase.rpc('save_public_patient_doc' as never, { p_token: lock.value!.tokens[index.value], p_fields: fields.value, p_complete: true } as never)
  saving.value = false
  if (e) {
    error.value = e.message
    return
  }
  index.value++
  await loadCurrent()
}

const initials = computed(() => (lock.value?.clinicName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase())
</script>

<template>
  <div v-if="lock" ref="topEl" class="flex min-h-full flex-col bg-surface" style="padding-bottom: env(safe-area-inset-bottom)" data-cy="reception">
    <!-- No top inset here: app.vue's root box already pads for the status bar. -->
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3 md:px-10">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-brand text-[12px] font-bold text-white">{{ initials }}</span>
        <span class="truncate text-[15px] font-semibold text-ink-900">{{ lock.clinicName }}</span>
      </div>
      <button type="button" class="flex h-9 items-center gap-1.5 rounded-ctl px-2 text-[12.5px] text-ink-muted" data-cy="reception-exit" @click="exitOpen = true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
        {{ t('Reception mode', 'Modo recepción') }}
      </button>
    </header>

    <main class="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-5 py-6 md:px-10 md:py-8">
      <template v-if="phase === 'loading'">
        <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
        <UiSkeleton class="mt-3 h-7 w-2/3 rounded-ctlSm" />
        <UiSkeleton class="mt-6 h-40 w-full rounded-card" />
      </template>

      <template v-else-if="phase === 'fill'">
        <p class="text-[13px] text-ink-muted" data-cy="reception-step">
          {{ t(`Step ${index + 1} of ${total} · Hello, ${lock.firstName}`, `Paso ${index + 1} de ${total} · Hola, ${lock.firstName}`) }}
        </p>
        <h1 class="mt-1 text-[24px] font-semibold leading-tight text-ink-900" data-cy="reception-title">{{ title }}</h1>
        <div class="reception-doc mt-5">
          <DocBlocks :fields="fields" mode="fill" @update:fields="fields = $event" />
        </div>
        <p v-if="error" role="alert" class="mt-4 text-[13.5px] text-danger-text" data-cy="reception-error">{{ error }}</p>
        <button type="button" class="mt-6 flex h-12 items-center justify-center rounded-card bg-brand px-6 text-[16px] font-semibold text-white disabled:opacity-50 md:self-end" :disabled="saving" data-cy="reception-submit" @click="submit">
          {{ saving ? t('Saving…', 'Guardando…') : index + 1 < total ? t('Sign and continue', 'Firmar y continuar') : t('Sign and finish', 'Firmar y terminar') }}
        </button>
      </template>

      <div v-else class="m-auto flex max-w-[420px] flex-col items-center text-center" data-cy="reception-done">
        <span class="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success-text">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <h1 class="mt-4 text-[24px] font-semibold text-ink-900">{{ t(`Thank you, ${lock.firstName}`, `Gracias, ${lock.firstName}`) }}</h1>
        <p class="mt-2 text-[15px] leading-relaxed text-ink-muted">{{ t('All done. Please hand the device back to reception.', 'Ya está todo. Devuélvelo a recepción, por favor.') }}</p>
        <button type="button" class="mt-8 h-11 rounded-card border border-line-control px-5 text-[14px] font-medium text-ink-700" @click="exitOpen = true">{{ t('Reception: take it back', 'Recepción: recoger el dispositivo') }}</button>
      </div>
    </main>

    <ReceptionExit v-if="exitOpen" :staff-email="lock.staffEmail" :patient-id="lock.patientId" @close="exitOpen = false" />
  </div>
</template>

<style scoped>
/* A patient signing with a finger: bigger type and targets than the web's
   desk-side form, without forking DocBlocks. */
.reception-doc :deep(label) {
  font-size: 15px;
}
.reception-doc :deep(input:not([type='checkbox']):not([type='radio'])),
.reception-doc :deep(textarea),
.reception-doc :deep(select) {
  font-size: 16px;
  min-height: 44px;
}
.reception-doc :deep(input[type='checkbox']),
.reception-doc :deep(input[type='radio']) {
  width: 22px;
  height: 22px;
}
</style>
