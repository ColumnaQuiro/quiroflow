<script setup lang="ts">
const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const { patient, teamMember, loading } = useIdentity()

// Dual-identity users (rare, but the schema allows it -- see useIdentity.ts)
// get a simple view switcher instead of the app guessing for them.
const view = ref<'patient' | 'practitioner' | null>(null)
watch(
  [patient, teamMember, loading],
  ([p, tm, l]) => {
    if (l) return
    if (view.value) return
    if (p && !tm) view.value = 'patient'
    else if (tm && !p) view.value = 'practitioner'
  },
  { immediate: true },
)

const supabase = useSupabaseClient()
const { unregister: unregisterPush } = usePushNotifications()
async function signOut() {
  await unregisterPush()
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>

    <div v-else-if="!patient && !teamMember" class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="text-sm text-ink-muted">This account isn't linked to a patient or team record yet.</p>
      <UiBtn variant="secondary" @click="signOut">Sign out</UiBtn>
    </div>

    <template v-else>
      <!--
        Sign out lives in a slim top bar, not below the content -- the
        practitioner Inbox is a chat UI with its composer pinned to the
        bottom, and a full-width button below it would either crowd the
        composer or (worse) get pushed out of view entirely.
      -->
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

      <PatientHome v-if="view === 'patient' && patient" :patient-id="patient.id" :patient-first-name="patient.first_name" />
      <PractitionerInbox v-else-if="view === 'practitioner' && teamMember" :account-id="teamMember.account_id" />
    </template>
  </div>
</template>
