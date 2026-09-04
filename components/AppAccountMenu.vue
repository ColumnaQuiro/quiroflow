<script setup lang="ts">
const store = useAccountStore()
const supabase = useSupabaseClient()
const { can } = usePermission()
const t = useT()

const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const cashShiftOpen = ref(false)

const initials = computed(() => {
  const name = store.teamMember?.full_name ?? ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
})
const photoUrl = computed(() => {
  const path = store.teamMember?.photo_storage_path
  if (!path) return null
  return supabase.storage.from('team-member-photos').getPublicUrl(path).data.publicUrl
})
const roleLine = computed(() => (store.teamMember?.is_owner ? t('Owner', 'Propietario') : store.teamMember?.role === 'front_desk' ? t('Front Desk', 'Recepción') : t('Practitioner', 'Profesional')))

function onDocumentClick(e: MouseEvent) {
  if (menuOpen.value && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))

async function signOut() {
  await supabase.auth.signOut()
  store.reset()
  await navigateTo('/login')
}
</script>

<template>
  <div ref="menuRef" class="relative">
    <button
      type="button"
      class="flex h-8 items-center gap-2 rounded-ctl pl-1 pr-2 text-left hover:bg-surface-subtle"
      @click="menuOpen = !menuOpen"
    >
      <span class="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand text-[10px] font-bold text-white">
        <img v-if="photoUrl" :src="photoUrl" class="h-full w-full object-cover" alt="" />
        <template v-else>{{ initials }}</template>
      </span>
      <span class="hidden min-w-0 flex-col items-start sm:flex">
        <span class="max-w-[140px] truncate text-[12.5px] font-medium leading-tight text-ink-700">{{ store.teamMember?.full_name }}</span>
        <span class="text-[10.5px] leading-tight text-ink-muted2">{{ roleLine }}</span>
      </span>
      <svg width="10" height="10" viewBox="0 0 10 10" class="shrink-0 text-ink-faint"><path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
    </button>
    <div v-if="menuOpen" class="absolute right-0 top-full z-20 mt-1 w-max min-w-[180px] rounded-ctl border border-line bg-surface py-1 shadow-popover">
      <NuxtLink to="/account" class="block px-3 py-2 text-left text-[13px] text-ink-500 hover:bg-surface-subtle" @click="menuOpen = false">
        {{ t('Account Settings', 'Ajustes de la cuenta') }}
      </NuxtLink>
      <NuxtLink to="/subscription" class="block px-3 py-2 text-left text-[13px] text-ink-500 hover:bg-surface-subtle" @click="menuOpen = false">
        {{ t('Subscription', 'Suscripción') }}
      </NuxtLink>
      <button
        v-if="can('payments_allocate')"
        type="button"
        class="block w-full px-3 py-2 text-left text-[13px] text-ink-500 hover:bg-surface-subtle"
        @click="cashShiftOpen = true; menuOpen = false"
      >
        {{ t('Cash Shift', 'Turno de caja') }}
      </button>
      <button type="button" class="block w-full px-3 py-2 text-left text-[13px] text-ink-500 hover:bg-surface-subtle" @click="signOut">
        {{ t('Sign out', 'Cerrar sesión') }}
      </button>
    </div>

    <CashShiftModal v-if="cashShiftOpen" @close="cashShiftOpen = false" />
  </div>
</template>
