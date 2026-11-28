<script setup lang="ts">
import { learnContentImagePaths, learnInLanguage, type LearnArticleText } from '../../utils/learnContent'

// One article the clinic sent, read by the patient in the app or the portal
// (components/learn/Article.vue does the reading). Opening it tells the
// clinic it was read (api/learn/open). Shown in the language on the
// patient's record when the article has it (utils/learnContent.ts), and its
// cover and images are signed here. Shared with mobile/.
const props = defineProps<{ sendId: string; exercisesTo: string }>()

const t = useT()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()

interface Send {
  id: string
  opened_at: string | null
  accounts: { name: string } | null
  patients: { preferred_language: string | null } | null
  learn_articles: { title: string; summary: string | null; body: string; content: unknown; translations: unknown; video_url: string | null; media_path: string | null; cover_path: string | null; minutes: number | null; exercise_program_id: string | null } | null
}
const send = ref<Send | null>(null)
const text = ref<LearnArticleText | null>(null)
const mediaSrc = ref<string | null>(null)
const coverSrc = ref<string | null>(null)
const images = ref<Record<string, string>>({})
const phase = ref<'loading' | 'missing' | 'ready'>('loading')
const learnMedia = useLearnMedia()
onMounted(async () => {
  const { data } = await supabase
    .from('learn_sends')
    .select('id, opened_at, accounts(name), patients(preferred_language), learn_articles(title, summary, body, content, translations, video_url, media_path, cover_path, minutes, exercise_program_id)')
    .eq('id', props.sendId)
    .maybeSingle()
  send.value = data as unknown as Send | null
  const a = send.value?.learn_articles
  if (a) {
    text.value = learnInLanguage(a, send.value?.patients?.preferred_language)
    const signed = await learnMedia.signedUrls([a.media_path, a.cover_path, ...learnContentImagePaths(text.value.content)].filter((p): p is string => !!p))
    mediaSrc.value = a.media_path ? (signed[a.media_path] ?? null) : null
    coverSrc.value = a.cover_path ? (signed[a.cover_path] ?? null) : null
    images.value = signed
  }
  phase.value = a ? 'ready' : 'missing'
  if (send.value && !send.value.opened_at) authedFetch('/api/learn/open', { method: 'POST', body: { sendId: props.sendId } }).catch(() => {})
})
</script>

<template>
  <div data-cy="patient-learn-read" :data-phase="phase">
    <p v-if="phase === 'loading'" class="text-[15px] text-ink-muted">{{ t('Loading…', 'Cargando…') }}</p>
    <p v-else-if="phase === 'missing'" class="text-[15px] text-ink-700">{{ t('This article is no longer available.', 'Esta lectura ya no está disponible.') }}</p>
    <LearnArticle
      v-else-if="send?.learn_articles && text"
      :title="text.title"
      :summary="text.summary"
      :content="text.content"
      :images="images"
      :cover-src="coverSrc"
      :media-src="mediaSrc"
      :video-url="send.learn_articles.video_url"
      :minutes="send.learn_articles.minutes"
      :clinic-name="send.accounts?.name"
    >
      <NuxtLink v-if="send.learn_articles.exercise_program_id" :to="exercisesTo" class="rounded-card border border-line bg-surface-subtle p-4 text-[15px] font-semibold text-brand-text">
        {{ t('Your exercises', 'Tus ejercicios') }} ›
      </NuxtLink>
    </LearnArticle>
  </div>
</template>
