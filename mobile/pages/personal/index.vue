<script setup lang="ts">
// Personal, in the app (owners only): the web's pages/personal/index.vue --
// who is in today, holidays left, the month's hours and what is waiting for
// the owner (Personas); the whole team's leave across a year (Vacaciones);
// and the month's pack for the gestoría (Gestoría). The same components as
// the web, so a figure here is the figure there; they read the account
// store, which the app answers with composables/useAccountStore.ts. Each
// person opens onto their file (pages/personal/[id].vue).
//
// Reached from the iPad's side menu and from the Reports hub on a phone,
// where the five tabs are already taken.
import { shareReportFile, shareReportMessage } from '~/utils/shareReportFile'

definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const route = useRoute()
const router = useRouter()
const authedFetch = useAuthedFetch()
const { context, loading } = usePractitionerContext()
const timeZone = computed(() => context.value?.timeZone || DEFAULT_CLINIC_TIMEZONE)

type Tab = 'people' | 'leave' | 'gestoria'
const tab = computed<Tab>({
  get: () => (route.query.tab === 'leave' || route.query.tab === 'gestoria' ? route.query.tab : 'people'),
  set: (v) => router.replace({ query: { ...route.query, tab: v === 'people' ? undefined : v } }),
})
const tabs = computed(() => [
  { key: 'people' as const, label: t('People', 'Personas') },
  { key: 'leave' as const, label: t('Holidays', 'Vacaciones') },
  { key: 'gestoria' as const, label: t('Accountant', 'Gestoría') },
])

// The gestoría's files: a link to /api/... goes nowhere inside the app, so
// each is fetched with the session and handed to the share sheet -- save it
// to Files or mail it to the gestoría from there.
const shareNote = ref<string | null>(null)
const sharing = ref(false)
async function download(path: string, filename: string) {
  if (sharing.value) return
  sharing.value = true
  shareNote.value = null
  try {
    const blob = await authedFetch<Blob>(path, { responseType: 'blob' })
    const result = await shareReportFile(blob, filename, filename.endsWith('.csv') ? 'text/csv' : 'application/pdf')
    shareNote.value = shareReportMessage(result, t)
  } catch (e: any) {
    shareNote.value = e?.data?.statusMessage ?? t("Couldn't make the download.", 'No se ha podido preparar la descarga.')
  } finally {
    sharing.value = false
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="staff-page">
    <AppPageHeader :title="t('Staff', 'Personal')" back @back="router.back()" />

    <div v-if="context?.isOwner && context.hasStaffSection" role="tablist" class="flex shrink-0 gap-1 border-b border-line bg-surface px-3 md:px-5">
      <button
        v-for="tb in tabs"
        :key="tb.key"
        type="button"
        role="tab"
        :aria-selected="tab === tb.key"
        :data-cy="`staff-tab-${tb.key}`"
        class="-mb-px flex h-11 shrink-0 items-center border-b-2 px-3 text-[14px] font-semibold"
        :class="tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted'"
        @click="tab = tb.key"
      >
        {{ tb.label }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-3.5 pb-8 pt-3 md:px-5">
      <AppSkeletonList v-if="loading && !context" :rows="4" />
      <p v-else-if="!context?.isOwner" class="mx-auto mt-10 max-w-[420px] text-center text-[14px] text-ink-muted" data-cy="staff-owners-only">
        {{ t('Staff is for the clinic’s owners.', 'Personal es solo para los propietarios de la clínica.') }}
      </p>
      <!-- No link to plans: the app does not sell subscriptions. -->
      <div v-else-if="!context.hasStaffSection" class="mx-auto mt-10 flex max-w-[420px] flex-col gap-2 text-center" data-cy="staff-plan-gate">
        <h2 class="text-[16px] font-bold text-ink-900">{{ t('Staff comes with Practice and Clinic', 'Personal viene con Practice y Clinic') }}</h2>
        <p class="text-[14px] text-ink-muted">{{ t('Everyone’s holidays for the year, a file per person with their contract and documents, payslips they see in the app, and the month’s pack for the gestoría.', 'Las vacaciones de todo el equipo en el año, una ficha por persona con su contrato y sus documentos, nóminas que ven en la app y el resumen del mes para la gestoría.') }}</p>
      </div>
      <div v-else class="mx-auto max-w-[1100px]">
        <StaffPeople v-if="tab === 'people'" :account-id="context.accountId" :time-zone="timeZone" :corrections-to="null" @open-leave="tab = 'leave'" />
        <template v-else-if="tab === 'gestoria'">
          <p v-if="shareNote" role="status" class="mb-3 rounded-card border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-700" data-cy="staff-share-note">{{ shareNote }}</p>
          <StaffGestoriaPack :download="download" />
        </template>
        <StaffLeaveYear v-else :account-id="context.accountId" :time-zone="timeZone" />
      </div>
    </div>
    <UiToastContainer />
  </div>
</template>
