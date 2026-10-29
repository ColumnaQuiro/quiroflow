<script setup lang="ts">
// "¿Qué tal te hemos atendido?" -- the link a satisfaction automation sends
// ({{satisfaction_link}}). No login: the phone that opens it has no session
// and needs none; the token, checked on the server, is the key. A tap from 1
// to 5 is saved at once; a 1-3 is then asked what to improve (optional, read
// by the clinic's owners), a 4-5 is offered the clinic's Google review page.
definePageMeta({ layout: false })

const route = useRoute()
const token = route.params.token as string

interface Survey { clinicName: string; firstName: string; visitAt: string | null; score: number | null; commented: boolean; locked: boolean; reviewUrl: string | null }

const phase = ref<'loading' | 'invalid' | 'ready'>('loading')
const survey = ref<Survey | null>(null)
const score = ref<number | null>(null)
const reviewUrl = ref<string | null>(null)
const comment = ref('')
const commentSent = ref(false)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    survey.value = await $fetch<Survey>(`/api/satisfaction/${token}`)
    score.value = survey.value.score
    reviewUrl.value = survey.value.reviewUrl
    commentSent.value = survey.value.commented
    phase.value = 'ready'
  } catch {
    phase.value = 'invalid'
  }
})

async function send(body: { score?: number; comment?: string }) {
  busy.value = true
  error.value = ''
  try {
    const r = await $fetch<{ score: number; reviewUrl: string | null }>(`/api/satisfaction/${token}`, { method: 'POST', body })
    score.value = r.score
    reviewUrl.value = r.reviewUrl
    if (body.comment !== undefined) commentSent.value = true
  } catch (e: any) {
    error.value = e?.statusCode === 409 ? 'Esta respuesta ya no se puede cambiar.' : 'No se ha podido guardar. Inténtalo de nuevo.'
  } finally {
    busy.value = false
  }
}

const visitDay = computed(() => (survey.value?.visitAt ? new Date(survey.value.visitAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) : ''))
const low = computed(() => score.value !== null && score.value <= 3)
</script>

<template>
  <div class="flex min-h-screen items-start justify-center bg-surface-page px-4 py-10 sm:items-center">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-card" data-cy="satisfaction-page">
      <p v-if="phase === 'loading'" class="text-center text-sm text-ink-faint">Cargando…</p>
      <p v-else-if="phase === 'invalid'" class="text-center text-sm text-danger-text" data-cy="satisfaction-invalid">Este enlace no es válido.</p>

      <template v-else-if="survey">
        <p class="text-[12.5px] font-medium text-ink-muted">{{ survey.clinicName }}</p>
        <h1 class="mt-1 text-[19px] font-semibold leading-snug text-ink-900">
          {{ survey.firstName ? `${survey.firstName}, ¿qué` : '¿Qué' }} tal te hemos atendido{{ visitDay ? ` el ${visitDay}` : '' }}?
        </h1>

        <div class="mt-4 grid grid-cols-5 gap-2" role="radiogroup" aria-label="Valoración de 1 a 5">
          <button
            v-for="n in 5"
            :key="n"
            type="button"
            role="radio"
            :aria-checked="score === n"
            :disabled="busy || survey.locked"
            class="h-12 rounded-ctl text-[18px] font-semibold disabled:opacity-70"
            :class="score === n ? 'bg-brand text-brand-on' : 'border border-line-control bg-surface text-ink-700'"
            :data-cy="`satisfaction-score-${n}`"
            @click="send({ score: n })"
          >
            {{ n }}
          </button>
        </div>
        <div class="mt-1.5 flex justify-between text-[11.5px] text-ink-faint"><span>Muy mal</span><span>Muy bien</span></div>

        <p v-if="error" role="alert" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>

        <div v-if="low && !commentSent && !survey.locked" class="mt-5" data-cy="satisfaction-improve">
          <label for="improve" class="text-[14.5px] font-semibold text-ink-900">Sentimos que no haya ido bien. ¿Qué podemos mejorar?</label>
          <textarea id="improve" v-model="comment" rows="4" maxlength="2000" class="mt-2 w-full resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14.5px] text-ink-900" data-cy="satisfaction-comment" />
          <p class="mt-1 text-[12px] text-ink-muted">Lo lee directamente la dirección de la clínica. Es opcional.</p>
          <button type="button" class="mt-3 flex min-h-11 w-full items-center justify-center rounded-ctl bg-brand text-[15px] font-semibold text-brand-on disabled:opacity-60" :disabled="busy || !comment.trim()" data-cy="satisfaction-send" @click="send({ comment })">
            {{ busy ? 'Enviando…' : 'Enviar' }}
          </button>
        </div>
        <p v-else-if="low" class="mt-5 text-[14px] text-ink-700" data-cy="satisfaction-thanks">Gracias por decírnoslo. Lo revisaremos.</p>

        <div v-else-if="score !== null" class="mt-5" data-cy="satisfaction-thanks">
          <p class="text-[14.5px] text-ink-700">¡Nos alegra mucho! Gracias por tu valoración.</p>
          <template v-if="reviewUrl">
            <p class="mt-2 text-[13.5px] text-ink-muted">Si te apetece, una reseña en Google ayuda a que otras personas nos encuentren.</p>
            <a :href="reviewUrl" class="mt-3 flex min-h-11 w-full items-center justify-center rounded-ctl bg-brand text-[15px] font-semibold text-brand-on" data-cy="satisfaction-review">Dejar reseña en Google</a>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>
