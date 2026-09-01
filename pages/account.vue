<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const store = useAccountStore()

const { showToast } = useToast()

const fullName = ref('')
const color = ref('#4C6FEB')
const savingProfile = ref(false)

watch(
  () => store.teamMember,
  (tm) => {
    if (tm) {
      fullName.value = tm.full_name
      color.value = tm.color
    }
  },
  { immediate: true },
)

async function saveProfile() {
  if (!store.teamMember) return
  savingProfile.value = true
  const { error } = await supabase
    .from('team_members')
    .update({ full_name: fullName.value.trim(), color: color.value })
    .eq('id', store.teamMember.id)
  savingProfile.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  store.teamMember.full_name = fullName.value.trim()
  store.teamMember.color = color.value
  showToast('Saved')
}

const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)

async function changePassword() {
  if (newPassword.value.length < 8) {
    showToast('Password must be at least 8 characters.', 'error')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    showToast('Passwords do not match.', 'error')
    return
  }
  savingPassword.value = true
  const { error } = await supabase.auth.updateUser({ password: newPassword.value })
  savingPassword.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  newPassword.value = ''
  confirmPassword.value = ''
  showToast('Password updated.')
}

const deletingAccount = ref(false)
async function deleteAccount() {
  if (!confirm("Delete your account? This signs you out and revokes your login immediately. This can't be undone by you -- an owner would need to re-invite you to come back.")) return
  deletingAccount.value = true
  try {
    await $fetch('/api/account/delete', { method: 'POST' })
  } catch (err: any) {
    deletingAccount.value = false
    showToast(err?.data?.statusMessage ?? 'Failed to delete account.', 'error')
    return
  }
  await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Account Settings" />
    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
    <div class="max-w-lg">
    <p class="text-sm text-ink-muted">Your personal details and login.</p>

    <form class="mt-6 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="saveProfile">
      <h2 class="text-sm font-semibold text-ink-900">Personal Details</h2>
      <div>
        <label class="block text-sm font-medium text-ink-700">Full Name</label>
        <input v-model="fullName" type="text" required class="mt-1 w-full rounded-ctl border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div>
        <label class="block text-sm font-medium text-ink-700">Email</label>
        <input :value="user?.email" type="email" disabled class="mt-1 w-full rounded-ctl border border-line bg-surface-subtle px-3 py-1.5 text-sm text-ink-muted" />
      </div>
      <div>
        <label class="block text-sm font-medium text-ink-700">Calendar Color</label>
        <input v-model="color" type="color" class="mt-1 h-9 w-14 rounded-ctl border border-line-control" />
      </div>
      <div class="flex items-center gap-3">
        <UiBtn type="submit" variant="primary" :disabled="savingProfile">
          {{ savingProfile ? 'Saving…' : 'Save' }}
        </UiBtn>
      </div>
    </form>

    <form class="mt-6 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="changePassword">
      <h2 class="text-sm font-semibold text-ink-900">Change Password</h2>
      <div>
        <label class="block text-sm font-medium text-ink-700">New Password</label>
        <input v-model="newPassword" type="password" required minlength="8" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div>
        <label class="block text-sm font-medium text-ink-700">Confirm New Password</label>
        <input v-model="confirmPassword" type="password" required minlength="8" class="mt-1 w-full rounded-ctl border border-line-control px-3 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div class="flex items-center gap-3">
        <UiBtn type="submit" variant="primary" :disabled="savingPassword">
          {{ savingPassword ? 'Saving…' : 'Update Password' }}
        </UiBtn>
      </div>
    </form>

    <div class="mt-6 space-y-3 rounded-card border border-danger-border bg-danger-bg p-4">
      <h2 class="text-sm font-semibold text-danger-text">Delete Account</h2>
      <p class="text-sm text-ink-muted">
        Removes your login from this clinic immediately. Your name stays attached to past appointments and records for
        the clinic's own history -- it isn't erased, just your access to it.
      </p>
      <UiBtn type="button" variant="secondary" class="border-danger-border text-danger-text" :disabled="deletingAccount" @click="deleteAccount">
        {{ deletingAccount ? 'Deleting…' : 'Delete Account' }}
      </UiBtn>
    </div>
    </div>
    </div>
  </div>
</template>
