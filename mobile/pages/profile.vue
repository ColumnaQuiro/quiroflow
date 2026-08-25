<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const supabase = useSupabaseClient()
const { context, loading } = usePractitionerContext()
const { unregister: unregisterPush } = usePushNotifications()

async function signOut() {
  await unregisterPush()
  await supabase.auth.signOut()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await new Promise((resolve) => setTimeout(resolve, 350))
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
      <div class="flex items-center gap-3">
        <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[18px] font-semibold text-brand-text">
          {{ (context?.fullName ?? '?').slice(0, 1).toUpperCase() }}
        </span>
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
    </div>
  </div>
</template>
