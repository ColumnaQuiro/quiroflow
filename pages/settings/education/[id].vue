<script setup lang="ts">
import { cleanLearnTag, learnTagLabel, learnTagsInUse, LEARN_TAGS, videoEmbedUrl } from '~/utils/learn'
import {
  estimateLearnMinutes,
  learnContentFromBody,
  learnContentImagePaths,
  learnContentIsEmpty,
  learnContentPlainText,
  LEARN_LANGUAGES,
  normalizeLearnContent,
  normalizeLearnTranslations,
  type LearnBlock,
  type LearnLanguage,
  type LearnTranslations,
} from '~/utils/learnContent'
import { docLanguageName } from '~/utils/docTranslations'

// One education article, written like a page (Ajustes › Educación › an
// article; the list is education/index.vue). The body is blocks
// (components/learn/BlockEditor.vue, utils/learnContent.ts): formatted text,
// headings, lists, quotes, callouts, dividers and images. Beside it what is
// the same in every language: the cover, the video, the tags -- the built-in
// ones and any the clinic adds -- the reading time, the exercises it goes
// with, and who sees it.
//
// Languages work as Settings › Docs does: one article, its words per
// language (learn_articles.translations). A language starts as a copy of
// the Spanish to translate over; a patient is shown the language on their
// record when the article has it.
//
// learn_articles.body is still written, as the plain text of the Spanish
// blocks: app versions already installed read only that.
//
// Media is deleted once nothing points at it: what the article had and no
// longer does when it is saved, and what was uploaded here and never saved
// when the page is left.

interface Row {
  id: string
  title: string
  summary: string | null
  body: string
  content: unknown
  translations: unknown
  video_url: string | null
  media_path: string | null
  cover_path: string | null
  asset_paths: string[]
  visible_to_patients: boolean
  announced_at: string | null
  tags: string[]
  minutes: number | null
  exercise_program_id: string | null
}

const t = useT()
const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { showToast } = useToast()
const authedFetch = useAuthedFetch()
const learnMedia = useLearnMedia()

const articleId = ref<string | null>(route.params.id === 'new' ? null : (route.params.id as string))

const form = reactive({
  title: '',
  summary: '',
  content: [] as LearnBlock[],
  video_url: '',
  media_path: null as string | null,
  cover_path: null as string | null,
  visible_to_patients: false,
  announce: true,
  tags: [] as string[],
  minutes: '' as string | number,
  exercise_program_id: '',
})
const translations = ref<LearnTranslations>({})
const announcedAt = ref<string | null>(null)
const savedAssets = ref<string[]>([])
const uploadedHere = new Set<string>()
const programs = ref<{ id: string; name: string }[]>([])
const libraryTags = ref<string[]>([])
const appPatients = ref(0)
const sentCount = ref(0)
const phase = ref<'loading' | 'missing' | 'ready'>('loading')
const snapshot = ref('')
const current = () => JSON.stringify({ ...form, announce: undefined, translations: translations.value })
const dirty = computed(() => phase.value === 'ready' && current() !== snapshot.value)

async function load() {
  if (!store.accountId) return
  const [p, lib, n] = await Promise.all([
    supabase.from('exercise_programs').select('id, name').eq('account_id', store.accountId).order('name'),
    supabase.from('learn_articles').select('tags').eq('account_id', store.accountId).is('archived_at', null),
    supabase.from('patients').select('id', { count: 'exact', head: true }).eq('account_id', store.accountId).not('user_id', 'is', null).eq('do_not_contact', false).eq('app_push_opted_out', false),
  ])
  programs.value = (p.data as { id: string; name: string }[] | null) ?? []
  libraryTags.value = learnTagsInUse((lib.data as { tags: string[] }[] | null) ?? [], { allBuiltIn: true })
  appPatients.value = n.count ?? 0
  if (articleId.value) {
    const [{ data }, s] = await Promise.all([
      supabase.from('learn_articles').select('id, title, summary, body, content, translations, video_url, media_path, cover_path, asset_paths, visible_to_patients, announced_at, tags, minutes, exercise_program_id').eq('id', articleId.value).eq('account_id', store.accountId).maybeSingle(),
      supabase.from('learn_sends').select('id', { count: 'exact', head: true }).eq('article_id', articleId.value),
    ])
    const a = data as Row | null
    if (!a) {
      phase.value = 'missing'
      return
    }
    const content = normalizeLearnContent(a.content)
    Object.assign(form, {
      title: a.title,
      summary: a.summary ?? '',
      content: content.length ? content : learnContentFromBody(a.body),
      video_url: a.video_url ?? '',
      media_path: a.media_path,
      cover_path: a.cover_path,
      visible_to_patients: a.visible_to_patients,
      announce: !a.announced_at,
      tags: [...a.tags],
      minutes: a.minutes ?? '',
      exercise_program_id: a.exercise_program_id ?? '',
    })
    translations.value = normalizeLearnTranslations(a.translations)
    announcedAt.value = a.announced_at
    savedAssets.value = [...a.asset_paths]
    sentCount.value = s.count ?? 0
  }
  phase.value = 'ready'
  await nextTick()
  snapshot.value = current()
  signCover()
}
watch(() => store.accountId, load, { immediate: true })

// ---- languages

const activeLanguage = ref<'es' | LearnLanguage>('es')
const languages = computed(() => LEARN_LANGUAGES.filter((code) => !!translations.value[code]))
const addable = computed(() => LEARN_LANGUAGES.filter((code) => !translations.value[code]))
const languageMenuOpen = ref(false)
function addLanguage(code: LearnLanguage) {
  languageMenuOpen.value = false
  // A copy of the Spanish to write over: the images and the layout are
  // usually the same, only the words change.
  translations.value = { ...translations.value, [code]: { title: '', summary: '', content: JSON.parse(JSON.stringify(form.content)) } }
  activeLanguage.value = code
}
const removingLanguage = ref(false)
function removeLanguage() {
  const code = activeLanguage.value
  if (code === 'es') return
  const rest = { ...translations.value }
  delete rest[code]
  translations.value = rest
  removingLanguage.value = false
  activeLanguage.value = 'es'
}
const original = computed(() => activeLanguage.value === 'es')
const tr = computed(() => (activeLanguage.value === 'es' ? null : (translations.value[activeLanguage.value] ?? null)))
const title = computed({
  get: () => (tr.value ? tr.value.title : form.title),
  set: (v: string) => (tr.value ? (tr.value.title = v) : (form.title = v)),
})
const summary = computed({
  get: () => (tr.value ? tr.value.summary : form.summary),
  set: (v: string) => (tr.value ? (tr.value.summary = v) : (form.summary = v)),
})
const content = computed({
  get: () => (tr.value ? tr.value.content : form.content),
  set: (v: LearnBlock[]) => (tr.value ? (tr.value.content = v) : (form.content = v)),
})

// ---- media

const formError = ref('')
const editorRef = ref<{ uploading: boolean } | null>(null)
async function uploadImage(file: File): Promise<{ path: string } | { error: string }> {
  if (!store.accountId) return { error: t('No clinic selected.', 'No hay clínica seleccionada.') }
  return learnMedia.uploadImage(store.accountId, file)
}
function onUploaded(path: string) {
  uploadedHere.add(path)
}
const sign = (paths: string[]) => learnMedia.signedUrls(paths)

const coverSrc = ref<string | null>(null)
async function signCover() {
  const path = form.cover_path
  coverSrc.value = path ? ((await learnMedia.signedUrls([path]))[path] ?? null) : null
}
const coverInput = ref<HTMLInputElement | null>(null)
const uploadingCover = ref(false)
async function onCover(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file) return
  formError.value = ''
  uploadingCover.value = true
  const result = await uploadImage(file)
  uploadingCover.value = false
  if ('error' in result) return (formError.value = result.error)
  uploadedHere.add(result.path)
  form.cover_path = result.path
  signCover()
}
function removeCover() {
  form.cover_path = null
  coverSrc.value = null
}

const uploadingVideo = ref(false)
const videoInput = ref<HTMLInputElement | null>(null)
async function onVideo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || !store.accountId) return
  formError.value = ''
  uploadingVideo.value = true
  const result = await learnMedia.upload(store.accountId, file)
  uploadingVideo.value = false
  if ('error' in result) return (formError.value = result.error)
  uploadedHere.add(result.path)
  form.media_path = result.path
}
function previewVideo() {
  const path = form.media_path
  if (path) openWhenReady(() => learnMedia.signedUrl(path))
}
const videoNote = computed(() => (form.video_url.trim() && !videoEmbedUrl(form.video_url) ? t('Only YouTube and Vimeo play inside the article; other links are shown as a link.', 'Solo YouTube y Vimeo se ven dentro de la lectura; otros enlaces se muestran como enlace.') : ''))

// ---- tags: the built-in ones, the clinic's own, and a new one

const tagOptions = computed(() => [...new Set([...libraryTags.value, ...form.tags])])
function toggleTag(key: string) {
  form.tags = form.tags.includes(key) ? form.tags.filter((x) => x !== key) : [...form.tags, key]
}
const newTag = ref('')
const foldTag = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
function addTag() {
  const typed = cleanLearnTag(newTag.value)
  newTag.value = ''
  if (!typed) return
  // "lumbar" or "nutricion" typed again is the tag that already exists.
  const existing = tagOptions.value.find((k) => foldTag(k) === foldTag(typed) || foldTag(learnTagLabel(k)) === foldTag(typed))
  const key = existing ?? typed
  if (!form.tags.includes(key)) form.tags = [...form.tags, key]
  if (!libraryTags.value.includes(key)) libraryTags.value = [...libraryTags.value, key]
}

// ---- saving

const estimated = computed(() => estimateLearnMinutes(form.content))
const canAnnounce = computed(() => form.visible_to_patients && !announcedAt.value)
const saving = ref(false)
function assetsOf(): string[] {
  const paths = new Set<string>()
  if (form.media_path) paths.add(form.media_path)
  if (form.cover_path) paths.add(form.cover_path)
  for (const p of learnContentImagePaths(form.content)) paths.add(p)
  for (const code of languages.value) for (const p of learnContentImagePaths(translations.value[code]!.content)) paths.add(p)
  return [...paths]
}
async function save() {
  if (!store.accountId) return
  formError.value = ''
  const blocks = normalizeLearnContent(form.content)
  if (!form.title.trim()) {
    activeLanguage.value = 'es'
    return (formError.value = t('Give it a title.', 'Ponle un título.'))
  }
  if (learnContentIsEmpty(blocks) && !form.video_url.trim() && !form.media_path) return (formError.value = t('Write something or add a video.', 'Escribe algo o añade un vídeo.'))
  if (uploadingVideo.value || uploadingCover.value || editorRef.value?.uploading) return (formError.value = t('Wait for the upload to finish.', 'Espera a que termine de subir.'))
  const minutes = form.minutes === '' ? null : Number(form.minutes)
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)) return (formError.value = t('Minutes: 1 to 60.', 'Minutos: de 1 a 60.'))
  saving.value = true
  const cleanTranslations: LearnTranslations = {}
  for (const code of languages.value) {
    const x = translations.value[code]!
    cleanTranslations[code] = { title: x.title.trim(), summary: x.summary.trim(), content: normalizeLearnContent(x.content) }
  }
  const row = {
    title: form.title.trim(),
    summary: form.summary.trim() || null,
    content: blocks,
    body: learnContentPlainText(blocks),
    translations: cleanTranslations,
    video_url: form.video_url.trim() || null,
    media_path: form.media_path,
    cover_path: form.cover_path,
    visible_to_patients: form.visible_to_patients,
    tags: form.tags,
    minutes,
    exercise_program_id: form.exercise_program_id || null,
    updated_at: new Date().toISOString(),
  }
  // content and translations are jsonb; their typed shape is utils/learnContent.ts.
  const { data: saved, error } = articleId.value
    ? await supabase.from('learn_articles').update(row as never).eq('id', articleId.value).select('id, asset_paths').single()
    : await supabase.from('learn_articles').insert({ ...row, account_id: store.accountId, created_by: store.teamMember?.id ?? null } as never).select('id, asset_paths').single()
  if (error || !saved) {
    saving.value = false
    return (formError.value = error?.message ?? t("Couldn't save it.", 'No se ha podido guardar.'))
  }
  const savedRow = saved as { id: string; asset_paths: string[] }
  // Media it had, or was given here, that it no longer uses.
  const kept = new Set(assetsOf())
  learnMedia.remove([...new Set([...savedAssets.value, ...uploadedHere])].filter((p) => !kept.has(p)))
  savedAssets.value = savedRow.asset_paths
  uploadedHere.clear()
  if (canAnnounce.value && form.announce) {
    try {
      const r = await authedFetch<{ recipients: number }>('/api/learn/announce', { method: 'POST', body: { articleId: savedRow.id } })
      announcedAt.value = new Date().toISOString()
      showToast(t(`Published. ${r.recipients} patients with the app were told.`, `Publicada. Se ha avisado a ${r.recipients} pacientes con la app.`), 'success')
    } catch {
      showToast(t('Saved, but the notice could not be sent.', 'Guardada, pero no se ha podido avisar.'), 'error')
    }
  } else showToast(t('Saved.', 'Guardada.'), 'success')
  saving.value = false
  snapshot.value = current()
  if (!articleId.value) {
    articleId.value = savedRow.id
    await navigateTo(`/settings/education/${savedRow.id}`, { replace: true })
  }
}

// Leaving with changes: ask. Leaving at all: what was uploaded and never saved goes.
onBeforeRouteLeave((to) => {
  if (articleId.value && to.path === `/settings/education/${articleId.value}`) return true
  if (dirty.value && !window.confirm(t('Leave without saving your changes?', '¿Salir sin guardar los cambios?'))) return false
  const kept = new Set(savedAssets.value)
  learnMedia.remove([...uploadedHere].filter((p) => !kept.has(p)))
  return true
})
function beforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.value) return
  e.preventDefault()
  e.returnValue = ''
}
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (!saving.value && phase.value === 'ready') save()
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('keydown', onKey)
})

// ---- preview, as a patient in the active language sees it

const preview = ref(false)
const previewImages = ref<Record<string, string>>({})
const previewText = computed(() => ({
  title: title.value.trim() || form.title || t('Untitled', 'Sin título'),
  summary: summary.value.trim() || form.summary || null,
  content: learnContentIsEmpty(content.value) ? form.content : content.value,
}))
watch(preview, async (on) => {
  if (on) previewImages.value = await learnMedia.signedUrls(learnContentImagePaths(previewText.value.content))
})

const inputClass = 'h-10 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const chip = (on: boolean) => (on ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700')
const languageName = (code: string) => docLanguageName(code, t)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="articleId ? t('Edit article', 'Editar lectura') : t('New article', 'Nueva lectura')" :meta="dirty ? t('Unsaved changes', 'Cambios sin guardar') : undefined">
      <NuxtLink to="/settings/education" class="text-[13px] font-medium text-ink-500 hover:text-ink-800" data-cy="learn-back">‹ {{ t('Education', 'Educación') }}</NuxtLink>
      <UiBtn :aria-pressed="preview" data-cy="learn-preview" @click="preview = !preview">{{ preview ? t('Edit', 'Editar') : t('Preview', 'Vista previa') }}</UiBtn>
      <UiBtn variant="primary" :disabled="saving || phase !== 'ready'" data-cy="learn-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto">
      <p v-if="phase === 'missing'" class="p-6 text-[14px] text-ink-700">{{ t('This article no longer exists.', 'Esta lectura ya no existe.') }}</p>
      <div v-else-if="phase === 'loading'" class="mx-auto flex max-w-[760px] flex-col gap-3 p-6" aria-hidden="true">
        <UiSkeleton class="h-9 w-2/3 rounded-ctlSm" /><UiSkeleton class="h-4 w-1/2 rounded-ctlSm" /><UiSkeleton class="mt-4 h-40 w-full rounded-card" />
      </div>
      <div v-else class="mx-auto flex max-w-[1180px] flex-col gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:flex-row lg:pb-10" data-cy="learn-form" data-ready="true">
        <!-- The page -->
        <main class="min-w-0 flex-1 lg:max-w-[760px] lg:pl-14">
          <!-- The original and each language it is in. -->
          <div class="mb-5 flex flex-wrap items-center gap-1 border-b border-line-row" role="tablist" :aria-label="t('Languages of this article', 'Idiomas de esta lectura')" data-cy="learn-language-tabs">
            <button
              v-for="code in ['es', ...languages] as ('es' | LearnLanguage)[]"
              :key="code"
              type="button"
              role="tab"
              :aria-selected="activeLanguage === code"
              :data-cy="`learn-language-tab-${code}`"
              class="-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[13.5px]"
              :class="activeLanguage === code ? 'border-brand font-semibold text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-700'"
              @click="activeLanguage = code; removingLanguage = false"
            >
              {{ languageName(code) }}
              <span v-if="code === 'es'" class="text-[12px] font-normal text-ink-muted">{{ t('original', 'original') }}</span>
              <span v-else-if="!translations[code]?.title.trim()" class="h-1.5 w-1.5 rounded-full bg-warning-text" :title="t('Still to translate', 'Por traducir')" />
            </button>
            <div v-if="addable.length" class="relative">
              <button type="button" class="inline-flex h-10 items-center px-3 text-[13.5px] font-semibold text-brand-text hover:underline" :aria-expanded="languageMenuOpen" data-cy="learn-add-language" @click="languageMenuOpen = !languageMenuOpen">+ {{ t('Add a language', 'Añadir idioma') }}</button>
              <div v-if="languageMenuOpen" class="absolute left-0 z-10 mt-1 w-44 rounded-ctl border border-line bg-surface py-1 shadow-popover">
                <button v-for="code in addable" :key="code" type="button" :data-cy="`learn-add-language-${code}`" class="block w-full px-3 py-1.5 text-left text-[13.5px] text-ink-700 hover:bg-surface-subtle" @click="addLanguage(code)">{{ languageName(code) }}</button>
              </div>
            </div>
          </div>

          <div v-if="!original" class="mb-4 flex flex-wrap items-center gap-3 rounded-ctl bg-surface-subtle px-3.5 py-2.5 text-[13px] text-ink-700" data-cy="learn-translation-note">
            <span class="min-w-0 flex-1">{{ t(`Patients whose language is ${languageName(activeLanguage)} read this version. It started as a copy of the Spanish: write over it. The cover, video and tags are shared.`, `Los pacientes con idioma ${languageName(activeLanguage).toLowerCase()} leen esta versión. Empieza como copia del español: escribe encima. La portada, el vídeo y las etiquetas son comunes.`) }}</span>
            <button v-if="!removingLanguage" type="button" class="font-semibold text-ink-muted hover:text-danger-text" @click="removingLanguage = true">{{ t('Remove this language', 'Quitar este idioma') }}</button>
            <template v-else>
              <span class="font-semibold text-danger-text">{{ t('Remove it?', '¿Quitarlo?') }}</span>
              <button type="button" class="font-semibold text-danger-text underline" data-cy="learn-remove-language" @click="removeLanguage">{{ t('Remove', 'Quitar') }}</button>
              <button type="button" class="font-semibold text-ink-muted" @click="removingLanguage = false">{{ t('Cancel', 'Cancelar') }}</button>
            </template>
          </div>

          <div v-if="preview" class="rounded-card border border-line bg-surface p-5 sm:p-8" data-cy="learn-preview-pane">
            <LearnArticle :title="previewText.title" :summary="previewText.summary" :content="previewText.content" :images="previewImages" :cover-src="coverSrc" :video-url="form.video_url || null" :minutes="form.minutes === '' ? estimated : Number(form.minutes)" :clinic-name="store.accountName" />
          </div>
          <template v-else>
            <!-- Cover -->
            <div class="group relative mb-4">
              <input ref="coverInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" data-cy="learn-cover-input" @change="onCover" />
              <div v-if="form.cover_path" class="relative overflow-hidden rounded-card bg-surface-subtle">
                <img v-if="coverSrc" :src="coverSrc" alt="" class="aspect-[16/9] w-full object-cover" data-cy="learn-cover-image" />
                <div v-else class="aspect-[16/9] w-full animate-pulse" />
                <div class="absolute right-3 top-3 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button type="button" class="rounded-ctl bg-surface px-2.5 py-1 text-[12.5px] font-semibold text-ink-800 shadow" @click="coverInput?.click()">{{ t('Change cover', 'Cambiar portada') }}</button>
                  <button type="button" class="rounded-ctl bg-surface px-2.5 py-1 text-[12.5px] font-semibold text-ink-800 shadow" data-cy="learn-cover-remove" @click="removeCover">{{ t('Remove', 'Quitar') }}</button>
                </div>
              </div>
              <button v-else-if="original" type="button" class="text-[13px] font-medium text-ink-muted hover:text-ink-800 disabled:opacity-60" :disabled="uploadingCover" data-cy="learn-cover-add" @click="coverInput?.click()">
                {{ uploadingCover ? t('Uploading…', 'Subiendo…') : `🖼 ${t('Add a cover', 'Añadir portada')}` }}
              </button>
            </div>

            <textarea
              v-model="title"
              rows="1"
              :placeholder="original ? t('Title', 'Título') : form.title"
              class="w-full resize-none overflow-hidden bg-transparent text-[30px] font-bold leading-tight text-ink-900 [field-sizing:content] placeholder:text-ink-faint focus:outline-none"
              data-cy="learn-title"
              @keydown.enter.prevent
            />
            <input
              v-model="summary"
              type="text"
              :placeholder="original ? t('One line on what it is about (optional)', 'Una línea sobre de qué va (opcional)') : form.summary || t('Summary', 'Resumen')"
              class="mt-1 w-full bg-transparent text-[16px] text-ink-500 placeholder:text-ink-faint focus:outline-none"
              data-cy="learn-summary"
            />
            <div class="mt-5">
              <LearnBlockEditor :key="activeLanguage" ref="editorRef" v-model="content" :upload="uploadImage" :sign="sign" @uploaded="onUploaded" @error="(m: string) => (formError = m)" />
            </div>
          </template>
          <p v-if="formError" role="alert" class="mt-3 text-[13px] font-semibold text-danger-text" data-cy="learn-error">{{ formError }}</p>
        </main>

        <!-- What is the same in every language -->
        <aside class="flex w-full shrink-0 flex-col gap-5 lg:sticky lg:top-6 lg:w-[300px] lg:self-start" data-cy="learn-properties">
          <section class="flex flex-col gap-2">
            <h2 class="text-[12.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ t('Tags', 'Etiquetas') }}</h2>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="key in tagOptions" :key="key" type="button" :aria-pressed="form.tags.includes(key)" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="chip(form.tags.includes(key))" :data-cy="`learn-tag-${key}`" @click="toggleTag(key)">
                {{ learnTagLabel(key) }}
              </button>
            </div>
            <form class="flex gap-1.5" @submit.prevent="addTag">
              <input v-model="newTag" type="text" maxlength="40" :placeholder="t('New tag, e.g. Nutrition', 'Nueva etiqueta, p. ej. Nutrición')" class="h-8 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] focus:border-brand focus:outline-none" data-cy="learn-new-tag" />
              <UiBtn type="submit" size="sm" :disabled="!newTag.trim()" data-cy="learn-add-tag">{{ t('Add', 'Añadir') }}</UiBtn>
            </form>
            <p class="text-[12px] text-ink-muted">{{ t(`The ${Object.keys(LEARN_TAGS).length} that come with QuiroFlow also suggest articles from the reason for visit; yours group and filter the library.`, `Las ${Object.keys(LEARN_TAGS).length} de QuiroFlow además sugieren lecturas según el motivo de consulta; las vuestras agrupan y filtran la biblioteca.`) }}</p>
          </section>

          <section class="flex flex-col gap-2" data-cy="learn-media-field">
            <h2 class="text-[12.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ t('Video', 'Vídeo') }}</h2>
            <input v-model="form.video_url" type="text" inputmode="url" autocapitalize="off" :placeholder="t('YouTube or Vimeo link', 'Enlace de YouTube o Vimeo')" :class="inputClass" data-cy="learn-video-url" />
            <p v-if="videoNote" class="text-[12.5px] text-warning-text">{{ videoNote }}</p>
            <div v-if="form.media_path" class="flex flex-wrap items-center gap-3 rounded-ctl border border-line-control bg-surface px-3 py-2 text-[12.5px]">
              <span class="font-medium text-ink-900" data-cy="learn-media-attached">{{ t('Video uploaded', 'Vídeo subido') }}</span>
              <button type="button" class="font-medium text-brand-text" @click="previewVideo">{{ t('View', 'Ver') }}</button>
              <button type="button" class="font-medium text-ink-muted hover:text-danger-text" data-cy="learn-media-remove" @click="form.media_path = null">{{ t('Remove', 'Quitar') }}</button>
            </div>
            <div v-else class="text-[12.5px]">
              <input ref="videoInput" type="file" accept="video/mp4,video/quicktime,video/webm" class="hidden" data-cy="learn-media-input" @change="onVideo" />
              <button type="button" class="font-medium text-brand-text disabled:text-ink-muted" :disabled="uploadingVideo" data-cy="learn-media-upload" @click="videoInput?.click()">
                {{ uploadingVideo ? t('Uploading… it can take a minute', 'Subiendo… puede tardar un minuto') : t('+ Or upload your own', '+ O sube uno vuestro') }}
              </button>
              <span class="ml-1 text-ink-faint">{{ t('vertical, up to 200 MB', 'vertical, hasta 200 MB') }}</span>
            </div>
          </section>

          <section class="grid grid-cols-[96px_1fr] gap-3">
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('Minutes', 'Minutos') }}
              <input v-model="form.minutes" type="number" min="1" max="60" :placeholder="estimated ? `≈ ${estimated}` : ''" :class="[inputClass, 'mt-1']" data-cy="learn-minutes" />
            </label>
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('Exercises with it', 'Ejercicios que lo acompañan') }}
              <select v-model="form.exercise_program_id" :class="[inputClass, 'mt-1']" data-cy="learn-program">
                <option value="">{{ t('None', 'Ninguno') }}</option>
                <option v-for="p in programs" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>
          </section>

          <fieldset class="flex flex-col gap-2" data-cy="learn-visibility">
            <legend class="mb-1.5 text-[12.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ t('Who sees it', 'Quién la ve') }}</legend>
            <label class="flex items-start gap-2.5 rounded-ctl border px-3 py-2.5 text-[13.5px] text-ink-900" :class="!form.visible_to_patients ? 'border-brand bg-brand-tint' : 'border-line-control'">
              <input v-model="form.visible_to_patients" type="radio" :value="false" class="mt-0.5" data-cy="learn-visible-sent" />
              <span><span class="font-semibold">{{ t('Only whoever it is sent to', 'Solo a quien se la envíe') }}</span><br /><span class="text-[12.5px] text-ink-muted">{{ t('From the patient record.', 'Desde la ficha del paciente.') }}</span></span>
            </label>
            <label class="flex items-start gap-2.5 rounded-ctl border px-3 py-2.5 text-[13.5px] text-ink-900" :class="form.visible_to_patients ? 'border-brand bg-brand-tint' : 'border-line-control'">
              <input v-model="form.visible_to_patients" type="radio" :value="true" class="mt-0.5" data-cy="learn-visible-all" />
              <span><span class="font-semibold">{{ t('Visible to all patients', 'Visible para todos los pacientes') }}</span><br /><span class="text-[12.5px] text-ink-muted">{{ t('In their app and portal, under Habits and advice.', 'En su app y su portal, en «Hábitos y consejos».') }}</span></span>
            </label>
            <label v-if="canAnnounce" class="flex items-start gap-2.5 rounded-ctl bg-surface-subtle px-3 py-2.5 text-[13.5px] text-ink-900" data-cy="learn-announce">
              <input v-model="form.announce" type="checkbox" class="mt-0.5" data-cy="learn-announce-check" />
              <span>
                <span class="font-semibold">{{ t('Tell them when it is published', 'Avisar al publicar') }}</span> · {{ t(`${appPatients} patients with the app`, `${appPatients} pacientes con la app`) }}<br />
                <span class="text-[12.5px] text-ink-muted">{{ t('One notification, when you save. Editing it later never sends another.', 'Un solo aviso, al guardar. Si la editas después, no se repite.') }}</span>
              </span>
            </label>
            <p v-else-if="form.visible_to_patients && announcedAt" class="text-[12.5px] text-ink-muted" data-cy="learn-announced">{{ t(`Patients were told on ${new Date(announcedAt).toLocaleDateString('en-GB')}.`, `Se avisó a los pacientes el ${new Date(announcedAt).toLocaleDateString('es-ES')}.`) }}</p>
          </fieldset>

          <p v-if="articleId" class="text-[12.5px] text-ink-muted">{{ t(`Sent ${sentCount} times.`, `Enviada ${sentCount} veces.`) }}</p>
        </aside>
      </div>
    </div>
  </div>
</template>
