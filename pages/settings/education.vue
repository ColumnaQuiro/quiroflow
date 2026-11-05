<script setup lang="ts">
import { LEARN_TAGS, videoEmbedUrl } from '~/utils/learn'
import { LEARN_STARTER } from '~/utils/learnStarter'

// Ajustes › Educación: the clinic's library of short articles and videos
// that practitioners send from a patient's record ("Lecturas",
// components/learn/StaffSend.vue). It can start from QuiroFlow's twelve
// (utils/learnStarter.ts), copied in once and the clinic's to edit from then
// on. An article already sent is archived rather than deleted: learn_sends
// cascades, and the patient would lose what they were given.
//
// An article can also be made visible to every patient ("Hábitos y
// consejos" in their app and portal, components/patient/LearnLibrary.vue),
// carry a video the clinic filmed itself (bucket learn-media, useLearnMedia),
// and be announced once with a push to everyone with the app
// (api/learn/announce).

interface Article {
  id: string
  title: string
  summary: string | null
  body: string
  video_url: string | null
  media_path: string | null
  visible_to_patients: boolean
  announced_at: string | null
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
const authedFetch = useAuthedFetch()
const learnMedia = useLearnMedia()

const articles = ref<Article[]>([])
const sentCounts = ref<Record<string, number>>({})
const programs = ref<{ id: string; name: string }[]>([])
// Who "Avisar al publicar" would reach: signed in to the app, not opted out.
const appPatients = ref(0)
const loading = ref(true)
async function load() {
  if (!store.accountId) return
  loading.value = true
  const [a, s, p, n] = await Promise.all([
    supabase.from('learn_articles').select('id, title, summary, body, video_url, media_path, visible_to_patients, announced_at, tags, minutes, exercise_program_id, starter_key, archived_at').eq('account_id', store.accountId).order('title'),
    supabase.from('learn_sends').select('article_id').eq('account_id', store.accountId),
    supabase.from('exercise_programs').select('id, name').eq('account_id', store.accountId).order('name'),
    supabase.from('patients').select('id', { count: 'exact', head: true }).eq('account_id', store.accountId).not('user_id', 'is', null).eq('do_not_contact', false).eq('app_push_opted_out', false),
  ])
  articles.value = (a.data as Article[] | null) ?? []
  const counts: Record<string, number> = {}
  for (const r of (s.data as { article_id: string }[] | null) ?? []) counts[r.article_id] = (counts[r.article_id] ?? 0) + 1
  sentCounts.value = counts
  programs.value = (p.data as { id: string; name: string }[] | null) ?? []
  appPatients.value = n.count ?? 0
  loading.value = false
}
watch(() => store.accountId, load, { immediate: true })

// '' = every article; 'visible' = the ones patients see; else a tag.
const tag = ref('')
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

// The form, for a new article or the one being edited.
const editingId = ref<string | null>(null)
const adding = ref(false)
const empty = () => ({ title: '', summary: '', body: '', video_url: '', media_path: null as string | null, visible_to_patients: false, announce: true, tags: [] as string[], minutes: '' as string | number, exercise_program_id: '' })
const form = reactive(empty())
const formError = ref('')
const saving = ref(false)
// The video the article had when the form opened, so a replaced or removed
// one can be deleted once the change is saved -- and a fresh upload deleted
// if the form is cancelled instead.
const savedMediaPath = ref<string | null>(null)
const announcedAt = ref<string | null>(null)
function openNew() {
  Object.assign(form, empty())
  savedMediaPath.value = null
  announcedAt.value = null
  editingId.value = null
  adding.value = true
  formError.value = ''
}
function edit(a: Article) {
  Object.assign(form, { title: a.title, summary: a.summary ?? '', body: a.body, video_url: a.video_url ?? '', media_path: a.media_path, visible_to_patients: a.visible_to_patients, announce: !a.announced_at, tags: [...a.tags], minutes: a.minutes ?? '', exercise_program_id: a.exercise_program_id ?? '' })
  savedMediaPath.value = a.media_path
  announcedAt.value = a.announced_at
  editingId.value = a.id
  adding.value = false
  formError.value = ''
}
function closeForm() {
  if (form.media_path && form.media_path !== savedMediaPath.value) learnMedia.remove(form.media_path)
  adding.value = false
  editingId.value = null
}
// "Avisar al publicar" applies only the first time an article is visible.
const canAnnounce = computed(() => form.visible_to_patients && !announcedAt.value)

const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
async function onVideo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || !store.accountId) return
  formError.value = ''
  uploading.value = true
  const result = await learnMedia.upload(store.accountId, file)
  uploading.value = false
  if ('error' in result) return (formError.value = result.error)
  // Replacing an upload made in this same form: that one is nobody's now.
  if (form.media_path && form.media_path !== savedMediaPath.value) learnMedia.remove(form.media_path)
  form.media_path = result.path
}
function removeVideo() {
  if (form.media_path && form.media_path !== savedMediaPath.value) learnMedia.remove(form.media_path)
  form.media_path = null
}
function previewVideo() {
  const path = form.media_path
  if (path) openWhenReady(() => learnMedia.signedUrl(path))
}
function toggleTag(key: string) {
  form.tags = form.tags.includes(key) ? form.tags.filter((x) => x !== key) : [...form.tags, key]
}
const videoNote = computed(() => (form.video_url.trim() && !videoEmbedUrl(form.video_url) ? t('Only YouTube and Vimeo play inside the article; other links are shown as a link.', 'Solo YouTube y Vimeo se ven dentro de la lectura; otros enlaces se muestran como enlace.') : ''))
async function save() {
  if (!store.accountId) return
  if (!form.title.trim()) return (formError.value = t('Give it a title.', 'Ponle un título.'))
  if (!form.body.trim() && !form.video_url.trim() && !form.media_path) return (formError.value = t('Write something or add a video.', 'Escribe algo o añade un vídeo.'))
  if (uploading.value) return (formError.value = t('Wait for the video to finish uploading.', 'Espera a que termine de subir el vídeo.'))
  const minutes = form.minutes === '' ? null : Number(form.minutes)
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)) return (formError.value = t('Minutes: 1 to 60.', 'Minutos: de 1 a 60.'))
  saving.value = true
  const row = {
    title: form.title.trim(),
    summary: form.summary.trim() || null,
    body: form.body.trim(),
    video_url: form.video_url.trim() || null,
    media_path: form.media_path,
    visible_to_patients: form.visible_to_patients,
    tags: form.tags,
    minutes,
    exercise_program_id: form.exercise_program_id || null,
    updated_at: new Date().toISOString(),
  }
  const { data: saved, error } = editingId.value
    ? await supabase.from('learn_articles').update(row).eq('id', editingId.value).select('id').single()
    : await supabase.from('learn_articles').insert({ ...row, account_id: store.accountId, created_by: store.teamMember?.id ?? null }).select('id').single()
  if (error || !saved) {
    saving.value = false
    return (formError.value = error?.message ?? t("Couldn't save it.", 'No se ha podido guardar.'))
  }
  // The old video, now that nothing points at it.
  if (savedMediaPath.value && savedMediaPath.value !== form.media_path) learnMedia.remove(savedMediaPath.value)
  savedMediaPath.value = form.media_path
  if (canAnnounce.value && form.announce) {
    try {
      const r = await authedFetch<{ recipients: number }>('/api/learn/announce', { method: 'POST', body: { articleId: saved.id } })
      showToast(t(`Published. ${r.recipients} patients with the app were told.`, `Publicada. Se ha avisado a ${r.recipients} pacientes con la app.`), 'success')
    } catch {
      showToast(t('Saved, but the notice could not be sent.', 'Guardada, pero no se ha podido avisar.'), 'error')
    }
  }
  saving.value = false
  closeForm()
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
  learnMedia.remove(a.media_path)
  await load()
}
const inputClass = 'h-10 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Education', 'Educación')">
      <UiBtn variant="primary" data-cy="learn-new" @click="openNew">{{ t('New article', 'Nueva lectura') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="learn-library" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t("Short articles and videos for your patients. Practitioners send them from the patient's record (Clinical › Reading); they arrive in the patient's app, or by email or a link without it. The ones you make visible to all are in every patient's app and portal, under Habits and advice.", 'Lecturas y vídeos cortos para tus pacientes. Se envían desde la ficha (Clínico › Lecturas) y llegan a su app o, si no la tiene, por email o con un enlace. Las que hagas visibles para todos salen en la app y el portal de cada paciente, en «Hábitos y consejos».') }}
          </p>

          <section v-if="!loading && missingStarters.length" class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-subtle p-4" data-cy="learn-starters">
            <p class="min-w-0 flex-1 text-[13.5px] text-ink-700">
              {{ t(`Start from QuiroFlow's ${missingStarters.length} articles in Spanish: first visit, low back, neck, headache, work posture, pregnancy… Yours to edit.`, `Empieza con ${missingStarters.length} lecturas de QuiroFlow: primera visita, lumbar, cuello, cefalea, postura en el trabajo, embarazo… Luego son tuyas para editar.`) }}
            </p>
            <UiBtn :disabled="addingStarters" data-cy="learn-add-starters" @click="addStarters">{{ addingStarters ? t('Adding…', 'Añadiendo…') : t(`Add the ${missingStarters.length}`, `Añadir las ${missingStarters.length}`) }}</UiBtn>
          </section>

          <form v-if="adding || editingId" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-[18px]" data-cy="learn-form" @submit.prevent="save">
            <h2 class="text-[15px] font-bold text-ink-900">{{ editingId ? t('Edit article', 'Editar lectura') : t('New article', 'Nueva lectura') }}</h2>
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('Title', 'Título') }}
              <input v-model="form.title" type="text" :class="[inputClass, 'mt-1']" data-cy="learn-title" />
            </label>
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('One line on what it is about (optional)', 'Una línea sobre de qué va (opcional)') }}
              <input v-model="form.summary" type="text" :class="[inputClass, 'mt-1']" data-cy="learn-summary" />
            </label>
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('Text · a blank line starts a new paragraph', 'Texto · una línea en blanco empieza un párrafo nuevo') }}
              <textarea v-model="form.body" rows="9" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] leading-relaxed text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" data-cy="learn-body" />
            </label>
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('Video link, YouTube or Vimeo (optional)', 'Enlace a vídeo de YouTube o Vimeo (opcional)') }}
              <input v-model="form.video_url" type="text" inputmode="url" autocapitalize="off" placeholder="https://" :class="[inputClass, 'mt-1']" data-cy="learn-video-url" />
            </label>
            <p v-if="videoNote" class="text-[12.5px] text-warning-text">{{ videoNote }}</p>
            <div class="text-[12.5px]" data-cy="learn-media-field">
              <p class="font-medium text-ink-700">{{ t('Or your own video, filmed on a phone: vertical, up to two minutes', 'O un vídeo vuestro, grabado con el móvil: vertical, hasta dos minutos') }}</p>
              <div v-if="form.media_path" class="mt-1 flex flex-wrap items-center gap-3 rounded-ctl border border-line-control bg-surface px-3 py-2">
                <span class="font-medium text-ink-900" data-cy="learn-media-attached">{{ t('Video uploaded', 'Vídeo subido') }}</span>
                <button type="button" class="font-medium text-brand-text" @click="previewVideo">{{ t('View', 'Ver') }}</button>
                <button type="button" class="font-medium text-ink-muted hover:text-danger-text" data-cy="learn-media-remove" @click="removeVideo">{{ t('Remove', 'Quitar') }}</button>
              </div>
              <div v-else class="mt-1">
                <input ref="fileInput" type="file" accept="video/mp4,video/quicktime,video/webm" class="hidden" data-cy="learn-media-input" @change="onVideo" />
                <button type="button" class="font-medium text-brand-text disabled:text-ink-muted" :disabled="uploading" data-cy="learn-media-upload" @click="fileInput?.click()">
                  {{ uploading ? t('Uploading… it can take a minute', 'Subiendo… puede tardar un minuto') : t('+ Upload a video', '+ Subir un vídeo') }}
                </button>
                <span class="ml-2 text-ink-faint">{{ t('up to 200 MB', 'hasta 200 MB') }}</span>
              </div>
            </div>
            <fieldset>
              <legend class="text-[12.5px] font-medium text-ink-700">{{ t('Reasons for visit it is for', 'Motivos de consulta') }}</legend>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <button v-for="(label, key) in LEARN_TAGS" :key="key" type="button" :aria-pressed="form.tags.includes(key)" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="form.tags.includes(key) ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :data-cy="`learn-tag-${key}`" @click="toggleTag(key)">{{ label }}</button>
              </div>
            </fieldset>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
              <label class="block text-[12.5px] font-medium text-ink-700">
                {{ t('Minutes', 'Minutos') }}
                <input v-model="form.minutes" type="number" min="1" max="60" :class="[inputClass, 'mt-1']" data-cy="learn-minutes" />
              </label>
              <label class="block text-[12.5px] font-medium text-ink-700">
                {{ t('Exercise programme to go with it (optional)', 'Programa de ejercicios que lo acompaña (opcional)') }}
                <select v-model="form.exercise_program_id" :class="[inputClass, 'mt-1']" data-cy="learn-program">
                  <option value="">{{ t('None', 'Ninguno') }}</option>
                  <option v-for="p in programs" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </label>
            </div>
            <fieldset class="flex flex-col gap-2" data-cy="learn-visibility">
              <legend class="mb-1.5 text-[12.5px] font-medium text-ink-700">{{ t('Who sees it', 'Quién la ve') }}</legend>
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
                  <span class="text-[12.5px] text-ink-muted">{{ t('One notification, now. Editing it later never sends another.', 'Un solo aviso, ahora. Si la editas después, no se repite.') }}</span>
                </span>
              </label>
              <p v-else-if="form.visible_to_patients && announcedAt" class="text-[12.5px] text-ink-muted">{{ t(`Patients were told on ${new Date(announcedAt).toLocaleDateString('en-GB')}.`, `Se avisó a los pacientes el ${new Date(announcedAt).toLocaleDateString('es-ES')}.`) }}</p>
            </fieldset>
            <p v-if="formError" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
            <div class="flex gap-2">
              <UiBtn type="submit" variant="primary" :disabled="saving" data-cy="learn-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
              <UiBtn type="button" @click="closeForm">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            </div>
          </form>

          <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Filter by reason for visit', 'Filtrar por motivo')">
            <button type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="!tag ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="!tag" data-cy="learn-filter-all" @click="tag = ''">{{ t('All', 'Todas') }}</button>
            <button type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="tag === 'visible' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="tag === 'visible'" data-cy="learn-filter-visible" @click="tag = 'visible'">{{ t('Visible to all', 'Visibles para todos') }}</button>
            <button v-for="(label, key) in LEARN_TAGS" :key="key" type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="tag === key ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="tag === key" :data-cy="`learn-filter-${key}`" @click="tag = key">{{ label }}</button>
          </div>

          <section class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="px-[18px] pb-2 pt-4"><h2 class="text-[16px] font-bold text-ink-900">{{ t(`In the library · ${active.length}`, `En la biblioteca · ${active.length}`) }}</h2></div>
            <p v-if="!loading && !active.length" class="px-[18px] pb-4 text-[13.5px] text-ink-muted">{{ t('No articles here yet.', 'Aún no hay lecturas aquí.') }}</p>
            <ul class="divide-y divide-line-row">
              <li v-for="a in active" :key="a.id" class="flex items-start gap-3 px-[18px] py-3" data-cy="learn-row">
                <div class="min-w-0 flex-1">
                  <p class="text-[14.5px] font-semibold text-ink-900">{{ a.title }}</p>
                  <p class="text-[12.5px] text-ink-muted">
                    {{ [a.video_url || a.media_path ? t('Video', 'Vídeo') : t('Reading', 'Lectura'), a.minutes ? `${a.minutes} min` : null, a.starter_key ? 'QuiroFlow' : null, programs.find((p) => p.id === a.exercise_program_id)?.name].filter(Boolean).join(' · ') }}
                  </p>
                  <div v-if="a.tags.length" class="mt-1 flex flex-wrap gap-1"><UiPill v-for="x in a.tags" :key="x">{{ LEARN_TAGS[x] ?? x }}</UiPill></div>
                </div>
                <UiPill v-if="a.visible_to_patients" tone="success" class="shrink-0" data-cy="learn-row-visible">{{ t('Visible to all', 'Visible para todos') }}</UiPill>
                <span class="shrink-0 text-[12.5px] text-ink-muted">{{ t(`sent ${sentCounts[a.id] ?? 0} times`, `enviada ${sentCounts[a.id] ?? 0} veces`) }}</span>
                <button type="button" class="shrink-0 text-[12.5px] font-semibold text-brand-text" :data-cy="`learn-edit-${a.id}`" @click="edit(a)">{{ t('Edit', 'Editar') }}</button>
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
