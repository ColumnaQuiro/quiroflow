<script setup lang="ts">
import { LEARN_TAGS } from '../../utils/learn'

// "Hábitos y consejos", in the app and the portal: every article the clinic
// made visible to all its patients (learn_articles.visible_to_patients, read
// under the patient's own RLS). Opening one goes through
// open_library_article, which gives the patient a send of their own, so it
// is read in the same reader as "Para ti" and the record shows it was read.
// Nothing at all when the clinic has made nothing visible. Shared with mobile/.
const props = defineProps<{ linkTo: (sendId: string) => string }>()

const t = useT()
const supabase = useSupabaseClient()

interface Item { id: string; title: string; summary: string | null; tags: string[]; minutes: number | null; video_url: string | null; media_path: string | null; created_at: string }
const items = ref<Item[]>([])
const openedIds = ref<Set<string>>(new Set())
async function load() {
  const [a, s] = await Promise.all([
    supabase
      .from('learn_articles')
      .select('id, title, summary, tags, minutes, video_url, media_path, created_at')
      .eq('visible_to_patients', true)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('learn_sends').select('article_id').not('opened_at', 'is', null),
  ])
  items.value = (a.data as Item[] | null) ?? []
  openedIds.value = new Set(((s.data as { article_id: string }[] | null) ?? []).map((r) => r.article_id))
}
onMounted(load)

// Only the tags something here carries, in the library's own order.
const tags = computed(() => Object.keys(LEARN_TAGS).filter((k) => items.value.some((i) => i.tags.includes(k))))
const tag = ref('')
const shown = computed(() => items.value.filter((i) => !tag.value || i.tags.includes(tag.value)))
const isVideo = (i: Item) => Boolean(i.media_path || i.video_url)
// New for a month after it went up, until they open it.
const isNew = (i: Item) => !openedIds.value.has(i.id) && Date.now() - new Date(i.created_at).getTime() < 30 * 86400_000

const openingId = ref<string | null>(null)
const error = ref('')
async function open(i: Item) {
  if (openingId.value) return
  error.value = ''
  openingId.value = i.id
  const { data, error: e } = await supabase.rpc('open_library_article', { p_article_id: i.id })
  openingId.value = null
  if (e || !data) {
    error.value = t("Couldn't open it. Try again.", 'No se ha podido abrir. Inténtalo de nuevo.')
    return
  }
  await navigateTo(props.linkTo(data as string))
}
</script>

<template>
  <section v-if="items.length" class="flex flex-col gap-3" data-cy="patient-learn-library">
    <h2 class="text-[16px] font-bold text-ink-900">{{ t('Habits and advice', 'Hábitos y consejos') }}</h2>
    <div v-if="tags.length > 1" class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Filter', 'Filtrar')">
      <button type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="!tag ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="!tag" @click="tag = ''">{{ t('All', 'Todos') }}</button>
      <button v-for="k in tags" :key="k" type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="tag === k ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="tag === k" :data-cy="`patient-learn-library-tag-${k}`" @click="tag = k">{{ LEARN_TAGS[k] }}</button>
    </div>
    <ul class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      <li v-for="i in shown" :key="i.id">
        <button type="button" class="flex w-full flex-col gap-1.5 text-left disabled:opacity-60" :disabled="openingId === i.id" data-cy="patient-learn-library-item" @click="open(i)">
          <span class="relative flex aspect-[4/5] w-full items-center justify-center rounded-card" :class="isVideo(i) ? 'bg-ink-900 text-white' : 'border border-line bg-surface-subtle text-ink-muted'" aria-hidden="true">
            <svg v-if="isVideo(i)" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4" /></svg>
            <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>
            <span v-if="isNew(i)" class="absolute left-2 top-2"><UiPill tone="brand">{{ t('New', 'Nuevo') }}</UiPill></span>
          </span>
          <span class="text-[13.5px] font-semibold leading-snug text-ink-900">{{ i.title }}</span>
          <span v-if="i.minutes || isVideo(i)" class="text-[12px] text-ink-muted">{{ [isVideo(i) ? t('Video', 'Vídeo') : null, i.minutes ? `${i.minutes} min` : null].filter(Boolean).join(' · ') }}</span>
        </button>
      </li>
    </ul>
    <p v-if="error" role="alert" class="text-[13px] font-semibold text-danger-text">{{ error }}</p>
  </section>
</template>
