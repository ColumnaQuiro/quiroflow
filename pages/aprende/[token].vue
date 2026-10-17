<script setup lang="ts">
// An article a clinic sent to a patient who has no app (server/api/learn/
// send.post.ts mails this link, or the practitioner pastes it into
// WhatsApp). No login: the token, checked on the server, is the key, and the
// first open marks it read on the patient's record.
definePageMeta({ layout: false })
useHead({ meta: [{ name: 'robots', content: 'noindex' }] })

const route = useRoute()
const token = route.params.token as string

interface Article { clinicName: string; title: string; summary: string | null; body: string; videoUrl: string | null; minutes: number | null; programName: string | null }
const phase = ref<'loading' | 'invalid' | 'ready'>('loading')
const article = ref<Article | null>(null)
onMounted(async () => {
  try {
    article.value = await $fetch<Article>(`/api/learn/link/${token}`)
    useHead({ title: article.value.title })
    phase.value = 'ready'
  } catch {
    phase.value = 'invalid'
  }
})
</script>

<template>
  <main class="min-h-screen bg-surface-page px-4 py-8" data-cy="learn-link" :data-phase="phase">
    <div class="mx-auto max-w-[640px] rounded-card border border-line bg-surface p-5 sm:p-8">
      <p v-if="phase === 'loading'" class="text-[15px] text-ink-muted">Cargando…</p>
      <p v-else-if="phase === 'invalid'" class="text-[15px] text-ink-700" data-cy="learn-link-invalid">Este enlace no es válido. Pide a tu clínica que te lo envíe de nuevo.</p>
      <LearnArticle v-else-if="article" :title="article.title" :summary="article.summary" :body="article.body" :video-url="article.videoUrl" :minutes="article.minutes" :clinic-name="article.clinicName">
        <p v-if="article.programName" class="rounded-card border border-line bg-surface-subtle p-4 text-[14.5px] text-ink-700">
          Esta lectura va con los ejercicios «{{ article.programName }}». Pídelos en tu próxima visita o en la app de la clínica.
        </p>
      </LearnArticle>
    </div>
  </main>
</template>
