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
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 max-w-2xl flex-1">
      <h1 class="text-xl font-semibold text-gray-900">Migrate Attachments from PracticeHub</h1>
    <p class="mt-1 text-sm text-gray-500">
      PracticeHub doesn't offer a bulk file-download API — only a metadata export and a one-file-at-a-time "View"
      link in its own UI. This page gets you the rest of the way: a helper script that drives a real browser through
      your PracticeHub login to fetch every file and attach it to the matching patient.
    </p>

    <div class="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900">Progress</h3>
        <span class="text-sm text-gray-500">{{ loading ? 'Loading…' : `${migratedFiles} / ${totalFiles} files` }}</span>
      </div>
      <div class="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
        <div class="h-full rounded-full bg-indigo-600 transition-all" :style="{ width: `${progressPct}%` }"></div>
      </div>
      <p v-if="!loading && totalFiles === 0" class="mt-2 text-sm text-gray-400">
        No file records yet — import the PracticeHub "File Attachments - List" CSV first from
        <NuxtLink to="/settings/import" class="text-indigo-600 hover:text-indigo-500">Import Data</NuxtLink>.
      </p>
      <button type="button" class="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-500" @click="load">Refresh</button>
    </div>

    <div class="mt-4 space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-gray-900">Steps</h3>

      <div>
        <p class="text-sm font-medium text-gray-700">1. Import the attachment list</p>
        <p class="mt-0.5 text-sm text-gray-500">
          If you haven't already: export "File Attachments - List" from PracticeHub (Reports &rarr; Data Exports),
          then import it via <NuxtLink to="/settings/import" class="text-indigo-600 hover:text-indigo-500">Settings &rarr; Import Data</NuxtLink>.
          This creates the file records above — with names, sizes, and dates, but no content yet.
        </p>
      </div>

      <div>
        <p class="text-sm font-medium text-gray-700">2. Download the migration script</p>
        <p class="mt-0.5 text-sm text-gray-500">Runs on your own computer — it needs a real browser window for you to log into PracticeHub yourself.</p>
        <a
          href="/api/download/migrate-attachments-script"
          download="migrate-practicehub-attachments.mjs"
          class="mt-2 inline-block rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Download script
        </a>
      </div>

      <div>
        <p class="text-sm font-medium text-gray-700">3. Install dependencies (once)</p>
        <pre class="mt-1 overflow-x-auto rounded-md bg-gray-900 px-3 py-2 text-xs text-gray-100">npm install playwright @supabase/supabase-js papaparse ws
npx playwright install chromium</pre>
      </div>

      <div>
        <p class="text-sm font-medium text-gray-700">4. Run it</p>
        <p class="mt-0.5 text-sm text-gray-500">
          Fill in your PracticeHub URL and the CSV filename you downloaded, then copy the command below. It'll ask
          for your QuiroFlow login in the terminal, then open a browser window for you to log into PracticeHub — from
          there it runs on its own.
        </p>
        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            v-model="practicehubUrl"
            type="text"
            placeholder="https://your-clinic.practicehub.io"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <input
            v-model="csvFilename"
            type="text"
            placeholder="file-attachments.csv"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div class="mt-2 flex items-center gap-2">
          <pre class="flex-1 overflow-x-auto rounded-md bg-gray-900 px-3 py-2 text-xs text-gray-100">{{ command }}</pre>
          <button type="button" class="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50" @click="copyCommand">
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
      </div>

      <p class="text-xs text-gray-400">
        Safe to re-run and safe to interrupt — it only ever processes files still missing content, so progress is
        never lost. Your QuiroFlow and PracticeHub passwords are typed by you, directly into their own prompts; the
        script never stores or transmits either.
      </p>
    </div>
    </div>
  </div>
</template>
