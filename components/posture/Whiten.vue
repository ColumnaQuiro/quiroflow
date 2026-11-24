<script setup lang="ts">
import { cutoutVerdict, POSTURE_VIEWS, VIEW_LABELS, type PostureView, type StoredViews } from '../../utils/posture'
import { personOnWhite, postureJpeg } from '../../utils/postureWhite'

// "Fondo blanco" on a saved posture assessment: the person cut out onto
// white, for photos that were saved with the room behind them. The capture
// screen does this as each photo is taken (Capture.vue), but only where the
// device managed it, and an assessment saved before it existed, or on a
// device that could not, keeps its background in the record and in every
// report made from it -- which draws the stored photo as it is
// (server/utils/posturePdf.ts) and cannot cut anyone out itself, since the
// outline is never stored.
//
// So it is done again here, in the browser, with the same model and the
// same check as the capture screen: each photo downloaded, outlined, shown
// beside the original, and replaced in place only for the ones ticked. The
// same path and the same size, so the points, the measurements, the
// comparisons and the reports all carry on unchanged and simply show the
// white one. Replacing is final -- there is no copy of the original kept --
// which is why each photo is shown before it is saved, as at capture.
const props = defineProps<{ views: StoredViews; urls: Record<string, string> }>()
// `saved` hands back each replaced photo, by path, for the caller to show at
// once: a signed URL made again within the same second is the same URL, and
// the browser would show the photo it already has.
const emit = defineEmits<{ saved: [replaced: Record<string, Blob>]; cancel: [] }>()

const t = useT()
const supabase = useSupabaseClient()
const { detect, warm } = usePoseModel()

interface Row {
  view: PostureView
  path: string
  original: string
  white: { url: string; blob: Blob } | null
  reason: string | null
  use: boolean
}
const rows = ref<Row[]>([])
const working = ref(true)
const saving = ref(false)
const error = ref('')

function reasonText(reason: string): string {
  if (reason === 'too-small') return t('The person is too small in this photo to cut out.', 'La persona sale demasiado pequeña en esta foto para recortarla.')
  if (reason === 'too-large') return t('The person fills almost the whole photo, so it cannot be cut out.', 'La persona ocupa casi toda la foto, así que no se puede recortar.')
  if (reason === 'no-person') return t('No one was found in this photo.', 'No se ha encontrado a nadie en esta foto.')
  return t('The background could not be removed on this device.', 'No se ha podido quitar el fondo en este dispositivo.')
}

async function outline(view: PostureView): Promise<Row> {
  const sv = props.views[view]!
  const original = props.urls[sv.photo]!
  const row: Row = { view, path: sv.photo, original, white: null, reason: null, use: false }
  try {
    // Fetched, not drawn from the <img>: a cross-origin image would taint
    // the canvas and the white version could not be read back off it.
    const res = await fetch(original)
    if (!res.ok) throw new Error(`photo ${res.status}`)
    const bitmap = await createImageBitmap(await res.blob())
    // At the size stored with the points, which is the size it was saved at.
    const canvas = document.createElement('canvas')
    canvas.width = sv.width
    canvas.height = sv.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, sv.width, sv.height)
    bitmap.close()
    const { mask, missing } = await detect(canvas)
    const verdict = mask ? cutoutVerdict(mask).verdict : missing ?? 'failed'
    if (mask && verdict === 'ok') {
      const blob = await postureJpeg(personOnWhite(canvas, mask))
      row.white = { url: URL.createObjectURL(blob), blob }
      row.use = true
    } else row.reason = reasonText(verdict)
  } catch (e) {
    console.error('[posture] whiten', e)
    row.reason = reasonText('failed')
  }
  return row
}

onMounted(async () => {
  warm()
  const views = POSTURE_VIEWS.filter((v) => props.views[v] && props.urls[props.views[v]!.photo])
  // One at a time: the model runs one photo at a time anyway, and a row
  // appears as each is ready rather than all at the end.
  for (const v of views) rows.value.push(await outline(v))
  working.value = false
})
onBeforeUnmount(() => rows.value.forEach((r) => r.white && URL.revokeObjectURL(r.white.url)))

const chosen = computed(() => rows.value.filter((r) => r.use && r.white))

async function save() {
  if (!chosen.value.length) return
  saving.value = true
  error.value = ''
  try {
    const replaced: Record<string, Blob> = {}
    for (const r of chosen.value) {
      const { error: up } = await supabase.storage.from('patient-files').upload(r.path, r.white!.blob, { contentType: 'image/jpeg', upsert: true })
      if (up) throw new Error(up.message)
      replaced[r.path] = r.white!.blob
    }
    emit('saved', replaced)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiConfirmDialog
    :title="t('White background', 'Fondo blanco')"
    :confirm-label="chosen.length === 1 ? t('Replace 1 photo', 'Sustituir 1 foto') : t(`Replace ${chosen.length} photos`, `Sustituir ${chosen.length} fotos`)"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="saving"
    :disabled="working || !chosen.length"
    @confirm="save"
    @cancel="emit('cancel')"
  >
    <div class="flex flex-col gap-3" data-cy="posture-whiten" :data-ready="working ? undefined : 'true'">
      <p class="text-[14px] text-ink-700">
        {{ t('Each photo with the person cut out onto white, beside it as it is now. The ticked ones replace the saved photo, here and in every report. The points and measurements do not change.', 'Cada foto con la persona recortada sobre blanco, al lado de como está ahora. Las marcadas sustituyen a la foto guardada, aquí y en todos los informes. Los puntos y las medidas no cambian.') }}
      </p>
      <ul class="flex flex-col gap-3">
        <li v-for="r in rows" :key="r.view" class="flex flex-col gap-1.5" data-cy="posture-whiten-row" :data-view="r.view" :data-white="r.white ? 'true' : 'false'">
          <div class="flex items-center gap-2">
            <p class="flex-1 text-[13px] font-semibold text-ink-900">{{ VIEW_LABELS[r.view] }}</p>
            <label v-if="r.white" class="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink-700">
              <input v-model="r.use" type="checkbox" class="size-4 accent-brand" data-cy="posture-whiten-use" />
              {{ t('Use white', 'Usar blanco') }}
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <figure class="m-0 flex flex-col gap-1">
              <img :src="r.original" :alt="t(`${VIEW_LABELS[r.view]}, as saved`, `${VIEW_LABELS[r.view]}, como está`)" class="aspect-[3/4] w-full rounded-ctl border border-line bg-surface-subtle object-contain" />
              <figcaption class="text-center text-[11.5px] text-ink-muted">{{ t('Now', 'Ahora') }}</figcaption>
            </figure>
            <figure class="m-0 flex flex-col gap-1">
              <img v-if="r.white" :src="r.white.url" :alt="t(`${VIEW_LABELS[r.view]}, on white`, `${VIEW_LABELS[r.view]}, sobre blanco`)" class="aspect-[3/4] w-full rounded-ctl border border-line bg-white object-contain" :class="r.use ? '' : 'opacity-50'" />
              <div v-else class="flex aspect-[3/4] w-full items-center justify-center rounded-ctl border border-dashed border-line-control p-3 text-center text-[12px] text-ink-muted" data-cy="posture-whiten-reason">{{ r.reason }}</div>
              <figcaption class="text-center text-[11.5px] text-ink-muted">{{ t('On white', 'Sobre blanco') }}</figcaption>
            </figure>
          </div>
        </li>
      </ul>
      <p v-if="working" class="text-[13px] text-ink-muted" role="status">{{ rows.length ? t('Cutting out the next photo…', 'Recortando la siguiente foto…') : t('Loading the model and cutting out the first photo…', 'Cargando el modelo y recortando la primera foto…') }}</p>
      <p v-if="error" class="text-[13px] text-danger-text" role="alert">{{ error }}</p>
    </div>
  </UiConfirmDialog>
</template>
