<script setup lang="ts">
import { learnTagLabel, learnTagsInUse } from '~/utils/learn'
import { learnLanguagesOf } from '~/utils/learnContent'
import { docLanguageName } from '~/utils/docTranslations'
import { LEARN_STARTER } from '~/utils/learnStarter'

// Ajustes › Educación: the clinic's library of articles and videos that
// practitioners send from a patient's record ("Lecturas",
// components/learn/StaffSend.vue). It can start from QuiroFlow's twelve
// (utils/learnStarter.ts), copied in once and the clinic's to edit from then
// on. An article already sent is archived rather than deleted: learn_sends
// cascades, and the patient would lose what they were given.
//
// Each article is written in its own page (education/[id].vue): formatted
// text and images, a cover, a video, the clinic's own tags and other
// languages. An article can be made visible to every patient ("Hábitos y
// consejos" in their app and portal, components/patient/LearnLibrary.vue)
// and announced once with a push.

interface Article {
  id: string
  title: string
  video_url: string | null
  media_path: string | null
  cover_path: string | null
  asset_paths: string[]
  translations: unknown
  visible_to_patients: boolean
  tags: string[]
  minutes: number | null
  exercise_program_id: string | null
  starter_key: string | null
  archived_at: string | null
}

const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { showToast } = useToast()
const learnMedia = useLearnMedia()

const articles = ref<Article[]>([])
const sentCounts = ref<Record<string, number>>({})
const programs = ref<{ id: string; name: string }[]>([])
const covers = ref<Record<string, string>>({})
const loading = ref(true)
async function load() {
  if (!store.accountId) return
  loading.value = true
  const [a, s, p] = await Promise.all([
    supabase.from('learn_articles').select('id, title, video_url, media_path, cover_path, asset_paths, translations, visible_to_patients, tags, minutes, exercise_program_id, starter_key, archived_at').eq('account_id', store.accountId).order('title'),
    supabase.from('learn_sends').select('article_id').eq('account_id', store.accountId),
    supabase.from('exercise_programs').select('id, name').eq('account_id', store.accountId).order('name'),
  ])
  articles.value = (a.data as Article[] | null) ?? []
  const counts: Record<string, number> = {}
  for (const r of (s.data as { article_id: string }[] | null) ?? []) counts[r.article_id] = (counts[r.article_id] ?? 0) + 1
  sentCounts.value = counts
  programs.value = (p.data as { id: string; name: string }[] | null) ?? []
  loading.value = false
  covers.value = await learnMedia.signedUrls(articles.value.map((x) => x.cover_path).filter((x): x is string => !!x))
}
watch(() => store.accountId, load, { immediate: true })

// '' = every article; 'visible' = the ones patients see; else a tag.
const tag = ref('')
const tags = computed(() => learnTagsInUse(articles.value.filter((a) => !a.archived_at)))
const active = computed(() => articles.value.filter((a) => !a.archived_at && (!tag.value || (tag.value === 'visible' ? a.visible_to_patients : a.tags.includes(tag.value)))))
const archived = computed(() => articles.value.filter((a) => a.archived_at))
const missingStarters = computed(() => LEARN_STARTER.filter((s) => !articles.value.some((a) => a.starter_key === s.key)))

const addingStarters = ref(false)
async function addStarters() {
  if (!store.accountId || !missingStarters.value.length) return
  addingStarters.value = true
  const { error } = await supabase.from('learn_articles').insert(
    missingStarters.value.map((s) => ({ account_id: store.accountId!, title: s.title, summary: s.summary, body: s.body, tags: s.tags, minutes: s.minutes, starter_key: s.key, created_by: store.teamMember?.id ?? null })),
  )
  addingStarters.value = false
  if (error) return showToast(error.message, 'error')
  await load()
}

async function setArchived(a: Article, archive: boolean) {
  const { error } = await supabase.from('learn_articles').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', a.id)
  if (error) return showToast(error.message, 'error')
  await load()
}
async function remove(a: Article) {
  const { error } = await supabase.from('learn_articles').delete().eq('id', a.id)
  if (error) return showToast(error.message, 'error')
  learnMedia.remove(a.asset_paths)
  await load()
}
const kindOf = (a: Article) => (a.video_url || a.media_path ? t('Video', 'Vídeo') : t('Reading', 'Lectura'))
const chip = (on: boolean) => (on ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700')
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Education', 'Educación')">
      <UiBtn variant="primary" data-cy="learn-new" @click="navigateTo('/settings/education/new')">{{ t('New article', 'Nueva lectura') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="learn-library" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t("Articles and videos for your patients, with formatted text, images and other languages. Practitioners send them from the patient's record (Clinical › Reading); they arrive in the patient's app, or by email or a link without it. The ones you make visible to all are in every patient's app and portal, under Habits and advice.", 'Lecturas y vídeos para tus pacientes, con texto con formato, imágenes y otros idiomas. Se envían desde la ficha (Clínico › Lecturas) y llegan a su app o, si no la tiene, por email o con un enlace. Las que hagas visibles para todos salen en la app y el portal de cada paciente, en «Hábitos y consejos».') }}
          </p>

          <section v-if="!loading && missingStarters.length" class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-subtle p-4" data-cy="learn-starters">
            <p class="min-w-0 flex-1 text-[13.5px] text-ink-700">
              {{ t(`Start from QuiroFlow's ${missingStarters.length} articles in Spanish: first visit, low back, neck, headache, work posture, pregnancy… Yours to edit.`, `Empieza con ${missingStarters.length} lecturas de QuiroFlow: primera visita, lumbar, cuello, cefalea, postura en el trabajo, embarazo… Luego son tuyas para editar.`) }}
            </p>
            <UiBtn :disabled="addingStarters" data-cy="learn-add-starters" @click="addStarters">{{ addingStarters ? t('Adding…', 'Añadiendo…') : t(`Add the ${missingStarters.length}`, `Añadir las ${missingStarters.length}`) }}</UiBtn>
          </section>

          <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Filter by tag', 'Filtrar por etiqueta')">
            <button type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="chip(!tag)" :aria-pressed="!tag" data-cy="learn-filter-all" @click="tag = ''">{{ t('All', 'Todas') }}</button>
            <button type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="chip(tag === 'visible')" :aria-pressed="tag === 'visible'" data-cy="learn-filter-visible" @click="tag = 'visible'">{{ t('Visible to all', 'Visibles para todos') }}</button>
            <button v-for="key in tags" :key="key" type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="chip(tag === key)" :aria-pressed="tag === key" :data-cy="`learn-filter-${key}`" @click="tag = key">{{ learnTagLabel(key) }}</button>
          </div>

          <section class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="px-[18px] pb-2 pt-4"><h2 class="text-[16px] font-bold text-ink-900">{{ t(`In the library · ${active.length}`, `En la biblioteca · ${active.length}`) }}</h2></div>
            <div v-if="loading" class="divide-y divide-line-row border-t border-line-row" aria-hidden="true">
              <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-[18px] py-3.5"><UiSkeleton class="h-4 w-48 rounded-ctlSm" /><UiSkeleton class="ml-auto h-4 w-20 rounded-ctlSm" /></div>
            </div>
            <p v-else-if="!active.length" class="px-[18px] pb-4 text-[13.5px] text-ink-muted">{{ t('No articles here yet.', 'Aún no hay lecturas aquí.') }}</p>
            <ul class="divide-y divide-line-row">
              <li v-for="a in active" :key="a.id" class="flex items-start gap-3 px-[18px] py-3" data-cy="learn-row">
                <NuxtLink :to="`/settings/education/${a.id}`" class="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-ctl border border-line bg-surface-subtle text-ink-faint" tabindex="-1" aria-hidden="true">
                  <img v-if="a.cover_path && covers[a.cover_path]" :src="covers[a.cover_path]" alt="" class="h-full w-full object-cover" />
                  <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>
                </NuxtLink>
                <div class="min-w-0 flex-1">
                  <NuxtLink :to="`/settings/education/${a.id}`" class="text-[14.5px] font-semibold text-ink-900 hover:underline">{{ a.title }}</NuxtLink>
                  <p class="text-[12.5px] text-ink-muted">
                    {{ [kindOf(a), a.minutes ? `${a.minutes} min` : null, a.starter_key ? 'QuiroFlow' : null, programs.find((p) => p.id === a.exercise_program_id)?.name].filter(Boolean).join(' · ') }}
                  </p>
                  <div v-if="a.tags.length || learnLanguagesOf(a.translations).length" class="mt-1 flex flex-wrap gap-1">
                    <UiPill v-for="x in a.tags" :key="x">{{ learnTagLabel(x) }}</UiPill>
                    <UiPill v-for="code in learnLanguagesOf(a.translations)" :key="code" tone="brand" data-cy="learn-row-language">{{ docLanguageName(code, t) }}</UiPill>
                  </div>
                </div>
                <UiPill v-if="a.visible_to_patients" tone="success" class="shrink-0" data-cy="learn-row-visible">{{ t('Visible to all', 'Visible para todos') }}</UiPill>
                <span class="shrink-0 text-[12.5px] text-ink-muted">{{ t(`sent ${sentCounts[a.id] ?? 0} times`, `enviada ${sentCounts[a.id] ?? 0} veces`) }}</span>
                <NuxtLink :to="`/settings/education/${a.id}`" class="shrink-0 text-[12.5px] font-semibold text-brand-text" :data-cy="`learn-edit-${a.id}`">{{ t('Edit', 'Editar') }}</NuxtLink>
                <button v-if="sentCounts[a.id]" type="button" class="shrink-0 text-[12.5px] font-semibold text-ink-muted" data-cy="learn-archive" @click="setArchived(a, true)">{{ t('Archive', 'Archivar') }}</button>
                <button v-else type="button" class="shrink-0 text-[12.5px] font-semibold text-ink-muted" data-cy="learn-delete" @click="remove(a)">{{ t('Delete', 'Eliminar') }}</button>
              </li>
            </ul>
          </section>

          <details v-if="archived.length" class="rounded-card border border-line bg-surface px-[18px] py-3">
            <summary class="cursor-pointer text-[13.5px] font-semibold text-ink-700">{{ t(`Archived · ${archived.length}`, `Archivadas · ${archived.length}`) }}</summary>
            <ul class="mt-2 divide-y divide-line-row">
              <li v-for="a in archived" :key="a.id" class="flex items-center gap-3 py-2">
                <span class="flex-1 text-[13.5px] text-ink-700">{{ a.title }}</span>
                <button type="button" class="text-[12.5px] font-semibold text-brand-text" @click="setArchived(a, false)">{{ t('Restore', 'Recuperar') }}</button>
              </li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>
