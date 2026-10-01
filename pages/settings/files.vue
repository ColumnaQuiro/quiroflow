<script setup lang="ts">
// Settings > Files: the files attached to patients, and the two jobs that
// tidy them up after a migration. It replaces two pages:
//
// - Migrate Attachments, which walked a clinic through a CSV import and a
//   local Playwright script. The CSV importer it depended on was no longer
//   reachable from anywhere, and Import > Files does the job over
//   PracticeHub's API -- filling in any file that came across as a name
//   only. What is left of that page is the count of such files.
// - Compress Files, unchanged as a job. Uploads were already compressed as
//   they arrived; files brought in by Import > Files were not, and made up
//   nearly the whole backlog. The importer compresses them now too.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

interface MissingFile {
  id: string
  file_name: string
  created_at: string
  patient: { first_name: string; last_name: string | null } | null
}

const loading = ref(true)
const totalFiles = ref(0)
const storedFiles = ref(0)
const uncompressedFiles = ref(0)
const missingFiles = ref(0)
const missingSample = ref<MissingFile[]>([])

// Head counts: a select of the rows would stop at PostgREST's 1,000-row cap
// and report that as the total.
function files() {
  return supabase.from('patient_files').select('*', { count: 'exact', head: true }).eq('account_id', store.accountId!)
}

async function load() {
  const [total, stored, uncompressed, missing, sample] = await Promise.all([
    files(),
    files().not('storage_path', 'is', null),
    files().not('storage_path', 'is', null).is('compressed_at', null),
    files().is('storage_path', null),
    supabase
      .from('patient_files')
      .select('id, file_name, created_at, patient:patients(first_name, last_name)')
      .eq('account_id', store.accountId!)
      .is('storage_path', null)
      .order('created_at', { ascending: false })
      .limit(5),
  ])
  totalFiles.value = total.count ?? 0
  storedFiles.value = stored.count ?? 0
  uncompressedFiles.value = uncompressed.count ?? 0
  missingFiles.value = missing.count ?? 0
  missingSample.value = (sample.data ?? []) as unknown as MissingFile[]
  loading.value = false
}
onMounted(load)

const compressedFiles = computed(() => storedFiles.value - uncompressedFiles.value)
const progressPct = computed(() => (storedFiles.value === 0 ? 100 : Math.floor((compressedFiles.value / storedFiles.value) * 100)))

const running = ref(false)
const stopRequested = ref(false)
const processedThisRun = ref(0)
const bytesSavedThisRun = ref(0)
const skippedThisRun = ref(0)
const lastError = ref('')

async function run() {
  running.value = true
  stopRequested.value = false
  processedThisRun.value = 0
  bytesSavedThisRun.value = 0
  skippedThisRun.value = 0
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
      if (r.error) skippedThisRun.value++
      else bytesSavedThisRun.value += r.originalSize - r.newSize
    }
    uncompressedFiles.value = res.remaining

    if (res.results.length === 0 || res.remaining === 0) break
  }
  running.value = false
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const nf = new Intl.NumberFormat('es-ES')
function patientName(f: MissingFile) {
  return f.patient ? `${f.patient.first_name} ${f.patient.last_name ?? ''}`.trim() : '—'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Files', 'Archivos')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[860px] flex-1 flex-col gap-4" data-cy="files-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('The scans, photos and PDFs attached to patients: how many there are, and the two jobs that tidy them up after a migration.', 'Los escaneos, fotos y PDF adjuntos a los pacientes: cuántos hay, y los dos trabajos que los ordenan tras una migración.') }}
          </p>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div class="flex flex-col gap-0.5 rounded-card border border-line bg-surface px-4 py-3.5">
              <UiSkeleton v-if="loading" class="h-7 w-16 rounded-ctlSm" />
              <strong v-else class="text-[26px] font-bold tabular-nums text-ink-900" data-cy="files-total">{{ nf.format(totalFiles) }}</strong>
              <span class="text-[13px] text-ink-muted">{{ t('Files on patients', 'Archivos en pacientes') }}</span>
            </div>
            <div class="flex flex-col gap-0.5 rounded-card border border-line bg-surface px-4 py-3.5">
              <UiSkeleton v-if="loading" class="h-7 w-16 rounded-ctlSm" />
              <strong v-else class="text-[26px] font-bold tabular-nums" :class="missingFiles ? 'text-warning-text' : 'text-ink-900'" data-cy="files-missing">{{ nf.format(missingFiles) }}</strong>
              <span class="text-[13px] text-ink-muted">{{ t('Name only, file missing', 'Solo el nombre, falta el archivo') }}</span>
            </div>
            <div class="flex flex-col gap-0.5 rounded-card border border-line bg-surface px-4 py-3.5">
              <UiSkeleton v-if="loading" class="h-7 w-16 rounded-ctlSm" />
              <strong v-else class="text-[26px] font-bold tabular-nums text-ink-900" data-cy="files-uncompressed">{{ nf.format(uncompressedFiles) }}</strong>
              <span class="text-[13px] text-ink-muted">{{ t('Not compressed yet', 'Sin comprimir todavía') }}</span>
            </div>
          </div>

          <!-- Files that came across as a name only -->
          <section v-if="!loading && missingFiles > 0" aria-labelledby="h-missing" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="files-missing-card">
            <div class="flex flex-col gap-4 px-[18px] py-4 sm:flex-row sm:items-start">
              <div class="flex-1">
                <h2 id="h-missing" class="text-[16px] font-bold text-ink-900">
                  {{ missingFiles === 1 ? t('1 file came across without its content', '1 archivo llegó sin su contenido') : t(`${nf.format(missingFiles)} files came across without their content`, `${nf.format(missingFiles)} archivos llegaron sin su contenido`) }}
                </h2>
                <p class="mt-1 text-[13px] leading-snug text-ink-muted">
                  {{
                    t(
                      'They show on the patient with a name and a date but open to nothing. Import › Files fetches them from PracticeHub where PracticeHub still has a download link; its preview says how many it can fetch before anything is written, and it skips every file already here.',
                      'Aparecen en el paciente con nombre y fecha, pero no se pueden abrir. Importar › Archivos los trae de PracticeHub si PracticeHub aún tiene un enlace de descarga; su vista previa dice cuántos puede traer antes de escribir nada, y se salta los que ya están aquí.',
                    )
                  }}
                </p>
              </div>
              <NuxtLink
                to="/settings/import?source=practicehub&type=file_attachments"
                data-cy="files-fetch"
                class="inline-flex h-9 shrink-0 items-center justify-center self-start rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover touch:h-11"
              >
                {{ t('Fetch from PracticeHub', 'Traer de PracticeHub') }}
              </NuxtLink>
            </div>
            <details class="border-t border-line-row">
              <summary class="cursor-pointer px-[18px] py-3 text-[13px] font-semibold text-ink-muted hover:bg-surface-subtle">{{ t('Which ones', 'Cuáles') }}</summary>
              <ul class="flex flex-col gap-1.5 px-[18px] pb-3.5 text-[13px] text-ink-700">
                <li v-for="f in missingSample" :key="f.id">{{ f.file_name }} · {{ patientName(f) }} · {{ new Date(f.created_at).toLocaleDateString('es-ES') }}</li>
                <li v-if="missingFiles > missingSample.length" class="text-ink-muted">{{ t(`and ${nf.format(missingFiles - missingSample.length)} more`, `y ${nf.format(missingFiles - missingSample.length)} más`) }}</li>
              </ul>
            </details>
          </section>

          <!-- Compress -->
          <section aria-labelledby="h-compress" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="files-compress">
            <div class="px-[18px] pb-3 pt-4">
              <h2 id="h-compress" class="text-[16px] font-bold text-ink-900">{{ t('Compress', 'Comprimir') }}</h2>
              <p class="mt-1 text-[13px] leading-snug text-ink-muted">
                {{ t('Re-saves the photos inside PDFs and images at a high quality: 40–60 % smaller with no difference on screen. Each file once; safe to stop and start again.', 'Vuelve a guardar las fotos de los PDF e imágenes con calidad alta: un 40–60 % más pequeños sin diferencia en pantalla. Una vez por archivo; se puede parar y volver a empezar.') }}
              </p>
            </div>
            <div class="flex flex-col gap-2.5 border-t border-line-row px-[18px] pb-4 pt-3.5">
              <div class="flex items-baseline justify-between text-[13.5px] text-ink-700">
                <span v-if="loading"><UiSkeleton class="h-3.5 w-40 rounded-ctlSm" /></span>
                <span v-else data-cy="files-compress-progress">{{ t(`${nf.format(compressedFiles)} of ${nf.format(storedFiles)} compressed`, `${nf.format(compressedFiles)} de ${nf.format(storedFiles)} comprimidos`) }}</span>
                <span class="text-ink-muted">{{ loading ? '' : `${progressPct} %` }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-pill bg-surface-subtle">
                <div class="h-full rounded-pill bg-brand transition-all" :style="{ width: `${progressPct}%` }" />
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-3">
                <UiBtn v-if="!running" variant="primary" data-cy="files-compress-start" :disabled="loading || uncompressedFiles === 0" @click="run">
                  {{ uncompressedFiles === 0 ? t('Nothing to compress', 'Nada que comprimir') : uncompressedFiles === 1 ? t('Compress 1 file', 'Comprimir 1 archivo') : t(`Compress ${nf.format(uncompressedFiles)} files`, `Comprimir ${nf.format(uncompressedFiles)} archivos`) }}
                </UiBtn>
                <UiBtn v-else data-cy="files-compress-stop" @click="stopRequested = true">{{ t('Stop', 'Detener') }}</UiBtn>
                <span v-if="running" class="text-[12.5px] text-ink-muted">{{ t('Keep this page open while it runs.', 'Mantén esta página abierta mientras se ejecuta.') }}</span>
              </div>
              <div v-if="processedThisRun > 0" class="mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-muted" data-cy="files-compress-run">
                <p>{{ t(`This run: ${processedThisRun} files, ${formatBytes(bytesSavedThisRun)} saved.`, `Esta vez: ${processedThisRun} archivos, ${formatBytes(bytesSavedThisRun)} ahorrados.`) }}</p>
                <p v-if="skippedThisRun > 0" class="text-danger-text">{{ t(`${skippedThisRun} could not be read and were left as they were.`, `${skippedThisRun} no se pudieron leer y se dejaron como estaban.`) }}</p>
              </div>
              <p v-if="lastError" class="text-[12.5px] text-danger-text">{{ lastError }}</p>
            </div>
            <div class="flex gap-2.5 border-t border-line-row bg-surface-subtle px-[18px] py-3 text-[13px] leading-snug text-ink-700">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class="mt-px shrink-0 text-ink-muted"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
              <span>{{ t('Files uploaded in QuiroFlow, and files brought in by Import › Files, are compressed as they arrive.', 'Los archivos subidos en QuiroFlow, y los que trae Importar › Archivos, se comprimen al llegar.') }}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
