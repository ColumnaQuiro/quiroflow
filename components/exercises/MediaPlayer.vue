<script setup lang="ts">
import type { ExerciseMediaSource } from '../../composables/useExerciseMedia'

// An exercise's video or photo, played where it was asked for: the library
// row it belongs to, or the edit form's attached file.
//
// Both used to open it in a new tab, which on the web did nothing useful
// for the videos people actually upload. An iPhone films .mov, Chrome does
// not display a QuickTime file it is sent to as a page, and so the tab it
// opened stayed blank while the video went to Downloads. Inside a <video>
// element the same file plays. When a browser cannot decode one even there,
// this says so and offers the file, rather than an empty black box.
//
// Fullscreen is the element's own: the video, the photo or the YouTube
// frame, so it fills the screen with nothing of the page around it. On an
// iPhone only a video can go fullscreen, through WebKit's player.
const props = defineProps<{ source: ExerciseMediaSource; label: string; autoplay?: boolean }>()

const t = useT()
const media = useExerciseMedia()
const catalog = useExerciseCatalog()

const src = ref<string | null>(null)
const signFailed = ref(false)
const unplayable = ref(false)
const box = ref<HTMLElement | null>(null)

// Keyed on the content, not the object: a parent that builds the source in
// its template hands over a new object on every render.
const key = computed(() => JSON.stringify(props.source))
watch(
  key,
  async (k) => {
    src.value = null
    signFailed.value = false
    unplayable.value = false
    const s = props.source
    if (s.kind === 'catalog') src.value = catalog.media(s.slug).video
    else if (s.kind === 'embed') src.value = props.autoplay ? `${s.url}?autoplay=1` : s.url
    else {
      const url = await media.signedUrl(s.path)
      if (key.value !== k) return
      if (url) src.value = url
      else signFailed.value = true
    }
  },
  { immediate: true },
)

type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => void; webkitEnterFullscreen?: () => void }
const canFullscreen = ref(false)
onMounted(() => {
  const doc = document as Document & { webkitFullscreenEnabled?: boolean }
  canFullscreen.value = !!doc.fullscreenEnabled || !!doc.webkitFullscreenEnabled || (props.source.kind !== 'image' && props.source.kind !== 'embed' && 'webkitEnterFullscreen' in HTMLVideoElement.prototype)
})
function fullscreen() {
  const el = box.value?.querySelector<FullscreenEl>('video, iframe, img')
  if (!el) return
  if (el.requestFullscreen) el.requestFullscreen().catch(() => el.webkitEnterFullscreen?.())
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
  else el.webkitEnterFullscreen?.()
}
</script>

<template>
  <div ref="box" data-cy="exercise-media-player">
    <p v-if="signFailed" class="rounded-ctl bg-surface-subtle px-3 py-2 text-[13px] text-ink-muted">{{ t("Couldn't load it. Try again.", 'No se ha podido cargar. Inténtalo de nuevo.') }}</p>
    <UiSkeleton v-else-if="!src" class="aspect-video w-full rounded-ctl" />
    <template v-else-if="source.kind === 'video'">
      <video
        v-if="!unplayable"
        :src="src"
        :aria-label="label"
        :autoplay="autoplay"
        controls
        playsinline
        preload="auto"
        class="aspect-video w-full rounded-ctl bg-black object-contain"
        data-cy="exercise-media-video"
        @error="unplayable = true"
      />
      <div v-else class="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-ctl bg-surface-subtle p-4 text-center text-[13px] text-ink-muted" data-cy="exercise-media-unplayable">
        <p class="max-w-[340px]">{{ t("This browser can't play this video. Videos filmed on an iPhone play in Safari and in the app.", 'Este navegador no puede reproducir este vídeo. Los grabados con un iPhone se ven en Safari y en la app.') }}</p>
        <a :href="src" target="_blank" rel="noopener" class="font-medium text-brand-text">{{ t('Download the video', 'Descargar el vídeo') }}</a>
      </div>
    </template>
    <img v-else-if="source.kind === 'image'" :src="src" :alt="label" class="max-h-[60vh] w-full rounded-ctl bg-surface-subtle object-contain" data-cy="exercise-media-image" />
    <ExercisesCatalogVideo v-else-if="source.kind === 'catalog'" :slug="source.slug" :label="label" :autoplay="autoplay" />
    <div v-else class="relative w-full overflow-hidden rounded-ctl bg-ink-900" style="padding-top: 56.25%">
      <iframe
        :src="src"
        :title="label"
        class="absolute inset-0 h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
        data-cy="exercise-media-embed"
      />
    </div>

    <div v-if="src && !unplayable && (canFullscreen || source.kind === 'embed')" class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
      <button v-if="canFullscreen" type="button" class="inline-flex items-center gap-1.5 font-medium text-brand-text" data-cy="exercise-media-fullscreen" @click="fullscreen">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
        {{ t('Full screen', 'Pantalla completa') }}
      </button>
      <a v-if="source.kind === 'embed'" :href="source.link" target="_blank" rel="noopener" class="font-medium text-ink-muted hover:text-ink-700">{{ t('Open the link', 'Abrir el enlace') }}</a>
    </div>
  </div>
</template>
