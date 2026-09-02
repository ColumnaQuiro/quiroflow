<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const supabase = useSupabaseClient()
const { context, loading } = usePractitionerContext()
const { unregister: unregisterPush } = usePushNotifications()
const authedFetch = useAuthedFetch()

async function signOut() {
  await unregisterPush()
  await supabase.auth.signOut()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await new Promise((resolve) => setTimeout(resolve, 350))
  await navigateTo('/login')
}

async function onPhotoUploaded() {
  if (!context.value) return
  const { data } = await supabase.from('team_members').select('photo_storage_path').eq('id', context.value.teamMemberId).maybeSingle()
  if (data) context.value.photoStoragePath = data.photo_storage_path
}

const deletingAccount = ref(false)
async function deleteAccount() {
  if (!confirm("Delete your account? This signs you out and revokes your login immediately. This can't be undone by you -- an owner would need to re-invite you to come back.")) return
  deletingAccount.value = true
  try {
    await authedFetch('/api/account/delete', { method: 'POST' })
  } catch (err: any) {
    deletingAccount.value = false
    alert(err?.data?.statusMessage ?? 'Failed to delete account.')
    return
  }
  await unregisterPush()
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 border-b border-line bg-surface px-4 py-3">
      <h1 class="text-[17px] font-semibold text-ink-900">Profile</h1>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>

    <div v-else class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <div v-if="context" class="flex items-center gap-3">
        <SettingsTeamMemberPhotoUpload
          :account-id="context.accountId"
          :team-member-id="context.teamMemberId"
          :photo-storage-path="context.photoStoragePath"
          :initials="(context.fullName ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('') || '?'"
          :size="56"
          @uploaded="onPhotoUploaded"
        />
        <div class="min-w-0">
          <p class="truncate text-[17px] font-semibold text-ink-900">{{ context?.fullName }}</p>
          <p class="text-[12.5px] text-ink-muted2">{{ context?.isOwner ? 'Owner' : 'Team member' }}</p>
        </div>
      </div>

      <button
        type="button"
        class="w-full rounded-ctl border border-line-control px-4 py-2.5 text-center text-[14px] font-medium text-danger-text active:bg-surface-subtle"
        @click="signOut"
      >
        Sign out
      </button>

      <div class="mt-2 space-y-2 rounded-ctl border border-danger-border bg-danger-bg p-3">
        <p class="text-[12.5px] text-ink-muted">
          Deleting your account removes your login from this clinic immediately. Your name stays on past appointments
          for the clinic's own records -- it isn't erased, just your access.
        </p>
        <button
          type="button"
          class="w-full rounded-ctl border border-danger-border px-4 py-2.5 text-center text-[14px] font-medium text-danger-text active:bg-danger-bg2"
          :disabled="deletingAccount"
          @click="deleteAccount"
        >
          {{ deletingAccount ? 'Deleting…' : 'Delete Account' }}
        </button>
      </div>
    </div>
  </div>
</template>
