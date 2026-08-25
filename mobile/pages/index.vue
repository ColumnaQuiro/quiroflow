<script setup lang="ts">
const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const { patient, teamMember, loading } = useIdentity()

// Dual-identity users (rare, but the schema allows it -- see useIdentity.ts)
// get a simple view switcher instead of the app guessing for them. Picking
// "Practitioner" routes into the tabbed practitioner section (/my-day etc.);
// "Patient" stays here rendering PatientHome, since patients don't get tabs.
const view = ref<'patient' | 'practitioner' | null>(null)
watch(
  [patient, teamMember, loading],
  ([p, tm, l]) => {
    if (l) return
    if (tm && !p) {
      navigateTo('/my-day')
      return
    }
    if (view.value) return
    if (p && !tm) view.value = 'patient'
  },
  { immediate: true },
)

watch(view, (v) => {
  if (v === 'practitioner') navigateTo('/my-day')
})

const supabase = useSupabaseClient()
async function signOut() {
  await supabase.auth.signOut()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await new Promise((resolve) => setTimeout(resolve, 350))
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="loading" class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>

    <div v-else-if="!patient && !teamMember" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="max-w-xs text-sm text-ink-muted">This account isn't linked to a patient or team record yet.</p>
      <UiBtn variant="secondary" @click="signOut">Sign out</UiBtn>
    </div>

    <template v-else>
      <div class="flex shrink-0 items-center border-b border-line bg-surface px-3 py-1.5">
        <div v-if="patient && teamMember" class="flex gap-2">
          <button
            type="button"
            class="rounded-ctl px-3 py-1.5 text-[13px] font-medium"
            :class="view === 'patient' ? 'bg-brand-tint text-brand-text' : 'text-ink-muted'"
            @click="view = 'patient'"
          >
            Patient view
          </button>
          <button
            type="button"
            class="rounded-ctl px-3 py-1.5 text-[13px] font-medium"
            :class="view === 'practitioner' ? 'bg-brand-tint text-brand-text' : 'text-ink-muted'"
            @click="view = 'practitioner'"
          >
            Practitioner view
          </button>
        </div>
        <button type="button" class="ml-auto px-2 py-1.5 text-[12.5px] text-ink-faint" @click="signOut">Sign out</button>
      </div>

      <PatientHome v-if="patient" :patient-id="patient.id" :patient-first-name="patient.first_name" />
    </template>
  </div>
</template>
