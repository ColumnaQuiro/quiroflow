<script setup lang="ts">
const supabase = useSupabaseClient()
const t = useT()

const loading = ref(true)
const totalFiles = ref(0)
const uncompressedFiles = ref(0)

async function load() {
  loading.value = true
  const [{ count: total }, { count: uncompressed }] = await Promise.all([
    supabase.from('patient_files').select('*', { count: 'exact', head: true }).not('storage_path', 'is', null),
    supabase.from('patient_files').select('*', { count: 'exact', head: true }).not('storage_path', 'is', null).is('compressed_at', null),
  ])
  totalFiles.value = total ?? 0
  uncompressedFiles.value = uncompressed ?? 0
  loading.value = false
}
onMounted(load)

const doneFiles = computed(() => totalFiles.value - uncompressedFiles.value)
const progressPct = computed(() => (totalFiles.value === 0 ? 0 : Math.round((doneFiles.value / totalFiles.value) * 100)))

const running = ref(false)
const stopRequested = ref(false)
const processedThisRun = ref(0)
const bytesSavedThisRun = ref(0)
const errorCount = ref(0)
const lastError = ref('')

async function run() {
  running.value = true
  stopRequested.value = false
  processedThisRun.value = 0
  bytesSavedThisRun.value = 0
  errorCount.value = 0
  lastError.value = ''

  while (!stopRequested.value) {
    const res = await useStaffFetch<{ results: { compressed: boolean; originalSize: number; newSize: number; error?: string }[]; remaining: number }>(
      '/api/internal/compress-existing-files',
      { method: 'POST', body: { limit: 10 } },
    ).catch((e) => {
      lastError.value = e?.data?.statusMessage ?? e?.message ?? t('Request failed', 'Falló la solicitud')
      return null
    })
    if (!res) break

    processedThisRun.value += res.results.length
    for (const r of res.results) {
      if (r.error) errorCount.value++
      else bytesSavedThisRun.value += r.originalSize - r.newSize
    }
    uncompressedFiles.value = res.remaining

    if (res.results.length === 0 || res.remaining === 0) break
  }
  running.value = false
}
function stop() {
  stopRequested.value = true
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Compress Files', 'Comprimir archivos')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{
              t(
                'Re-encodes the photos embedded in uploaded PDFs and images at a high but non-original quality — files viewed on screen shrink 40-60% with no visible difference. Runs once per file: anything already compressed is skipped, so this is safe to stop and re-run at any time, and every new upload from now on is compressed automatically.',
                'Recodifica las fotos incluidas en los PDFs e imágenes subidos con una calidad alta pero no original — los archivos que se ven en pantalla se reducen un 40-60% sin diferencia visible. Se ejecuta una vez por archivo: lo que ya está comprimido se salta, así que es seguro detenerlo y volver a ejecutarlo cuando quieras, y cada archivo nuevo se comprime automáticamente a partir de ahora.',
              )
            }}
          </p>

          <div class="mt-6 rounded-card border border-line bg-surface p-4 shadow-card">
            <div class="flex items-center justify-between">
              <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('Progress', 'Progreso') }}</h3>
              <span class="text-[12.5px] text-ink-muted2">{{ loading ? t('Loading…', 'Cargando…') : `${doneFiles} / ${totalFiles}` }}</span>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-pill bg-surface-subtle">
              <div class="h-full rounded-pill bg-brand transition-all" :style="{ width: `${progressPct}%` }"></div>
            </div>

            <div class="mt-4 flex items-center gap-2">
              <UiBtn v-if="!running" variant="primary" :disabled="loading || uncompressedFiles === 0" @click="run">
                {{ uncompressedFiles === 0 ? t('Nothing to compress', 'Nada que comprimir') : t('Start', 'Iniciar') }}
              </UiBtn>
              <UiBtn v-else variant="secondary" @click="stop">{{ t('Stop', 'Detener') }}</UiBtn>
              <span v-if="running" class="text-[12.5px] text-ink-muted2">{{ t('Processing…', 'Procesando…') }}</span>
            </div>

            <div v-if="processedThisRun > 0" class="mt-3 space-y-0.5 border-t border-line-divider pt-3 text-[12.5px] text-ink-muted">
              <p>{{ t('This run:', 'Esta ejecución:') }} {{ processedThisRun }} {{ t('files processed', 'archivos procesados') }}</p>
              <p>{{ t('Space saved:', 'Espacio ahorrado:') }} <span class="font-medium text-success-text">{{ formatBytes(bytesSavedThisRun) }}</span></p>
              <p v-if="errorCount > 0" class="text-danger-text">{{ errorCount }} {{ t('files skipped (unsupported or unreadable) — marked done, left untouched', 'archivos omitidos (no compatibles o ilegibles) — marcados como hechos, sin modificar') }}</p>
            </div>
            <p v-if="lastError" class="mt-2 text-[12.5px] text-danger-text">{{ lastError }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
