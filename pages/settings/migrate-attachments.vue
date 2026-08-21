<script setup lang="ts">
const supabase = useSupabaseClient()

const loading = ref(true)
const totalFiles = ref(0)
const pendingFiles = ref(0)

async function load() {
  loading.value = true
  const [{ count: total }, { count: pending }] = await Promise.all([
    supabase.from('patient_files').select('*', { count: 'exact', head: true }),
    supabase.from('patient_files').select('*', { count: 'exact', head: true }).is('storage_path', null),
  ])
  totalFiles.value = total ?? 0
  pendingFiles.value = pending ?? 0
  loading.value = false
}
onMounted(load)

const migratedFiles = computed(() => totalFiles.value - pendingFiles.value)
const progressPct = computed(() => (totalFiles.value === 0 ? 0 : Math.round((migratedFiles.value / totalFiles.value) * 100)))

const practicehubUrl = ref('')
const csvFilename = ref('file-attachments.csv')

const command = computed(() => {
  const url = practicehubUrl.value.trim() || 'https://your-clinic.practicehub.io'
  const csv = csvFilename.value.trim() || 'file-attachments.csv'
  return `node migrate-practicehub-attachments.mjs ${csv} --practicehub-url=${url}`
})

const copied = ref(false)
async function copyCommand() {
  await navigator.clipboard.writeText(command.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Migrate Attachments" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            PracticeHub doesn't offer a bulk file-download API — only a metadata export and a one-file-at-a-time
            "View" link in its own UI. This page gets you the rest of the way: a helper script that drives a real
            browser through your PracticeHub login to fetch every file and attach it to the matching patient.
          </p>

          <div class="mt-6 rounded-card border border-line bg-surface p-4 shadow-card">
            <div class="flex items-center justify-between">
              <h3 class="text-[13.5px] font-[560] text-ink-700">Progress</h3>
              <span class="text-[12.5px] text-ink-muted2">{{ loading ? 'Loading…' : `${migratedFiles} / ${totalFiles} files` }}</span>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-pill bg-surface-subtle">
              <div class="h-full rounded-pill bg-brand transition-all" :style="{ width: `${progressPct}%` }"></div>
            </div>
            <p v-if="!loading && totalFiles === 0" class="mt-2 text-[12.5px] text-ink-faint">
              No file records yet — import the PracticeHub "File Attachments - List" CSV first from
              <NuxtLink to="/settings/import" class="text-brand-text hover:text-brand-hover">Import Patients (CSV)</NuxtLink>.
            </p>
            <button type="button" class="mt-2 text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="load">Refresh</button>
          </div>

          <div class="mt-4 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 class="text-[13.5px] font-[560] text-ink-700">Steps</h3>

            <div>
              <p class="text-[13px] font-medium text-ink-600">1. Import the attachment list</p>
              <p class="mt-0.5 text-[12.5px] text-ink-muted2">
                If you haven't already: export "File Attachments - List" from PracticeHub (Reports &rarr; Data
                Exports), then import it via
                <NuxtLink to="/settings/import" class="text-brand-text hover:text-brand-hover">Settings &rarr; Import Patients (CSV)</NuxtLink>.
                This creates the file records above — with names, sizes, and dates, but no content yet.
              </p>
            </div>

            <div>
              <p class="text-[13px] font-medium text-ink-600">2. Download the migration script</p>
              <p class="mt-0.5 text-[12.5px] text-ink-muted2">Runs on your own computer — it needs a real browser window for you to log into PracticeHub yourself.</p>
              <a
                href="/api/download/migrate-attachments-script"
                download="migrate-practicehub-attachments.mjs"
                class="mt-2 inline-flex h-8 items-center rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover"
              >
                Download script
              </a>
            </div>

            <div>
              <p class="text-[13px] font-medium text-ink-600">3. Install dependencies (once)</p>
              <pre class="mt-1 overflow-x-auto rounded-ctl bg-ink-900 px-3 py-2 text-[12px] text-white">npm install playwright @supabase/supabase-js papaparse ws
npx playwright install chromium</pre>
            </div>

            <div>
              <p class="text-[13px] font-medium text-ink-600">4. Run it</p>
              <p class="mt-0.5 text-[12.5px] text-ink-muted2">
                Fill in your PracticeHub URL and the CSV filename you downloaded, then copy the command below. It'll
                ask for your QuiroFlow login in the terminal, then open a browser window for you to log into
                PracticeHub — from there it runs on its own.
              </p>
              <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  v-model="practicehubUrl"
                  type="text"
                  placeholder="https://your-clinic.practicehub.io"
                  class="h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
                <input
                  v-model="csvFilename"
                  type="text"
                  placeholder="file-attachments.csv"
                  class="h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
              <div class="mt-2 flex items-center gap-2">
                <pre class="flex-1 overflow-x-auto rounded-ctl bg-ink-900 px-3 py-2 text-[12px] text-white">{{ command }}</pre>
                <button type="button" class="h-8 shrink-0 rounded-ctl border border-line-control px-3 text-[12.5px] font-medium text-ink-600 hover:border-line-controlHover" @click="copyCommand">
                  {{ copied ? 'Copied!' : 'Copy' }}
                </button>
              </div>
            </div>

            <p class="text-[12px] text-ink-faint">
              Safe to re-run and safe to interrupt — it only ever processes files still missing content, so progress
              is never lost. Your QuiroFlow and PracticeHub passwords are typed by you, directly into their own
              prompts; the script never stores or transmits either.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
