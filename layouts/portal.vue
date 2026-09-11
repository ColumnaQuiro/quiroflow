<script setup lang="ts">
// The patient portal's shell.
//
// Everything the portal shows used to live on one page: appointments,
// balance, bonos, invoices, documents and a collapsible message thread,
// stacked as six identically-weighted grey boxes in a 2xl column with no
// navigation at all. This splits them across real pages and gives the
// portal the same furniture the staff app has -- a sidebar on the desktop,
// a bottom tab bar on a phone -- so a patient can tell where they are and
// go somewhere specific.
//
// Deliberately NOT here: the "Delete account" button that used to sit in
// this header next to Sign out. One mis-click and a confirm() away from
// destroying their own login, permanently visible on every page. Account
// deletion belongs to the mobile app (where the app stores require it), not
// to a web header.
const supabase = useSupabaseClient()
const route = useRoute()
const t = useT()
const { settings } = usePatientAppInfo()
const { patient, fullName, initials } = usePortalPatient()

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/portal/login')
}

// 16x16 stroke paths, same convention as components/AppSidebar.vue so the
// two shells look like one product.
const nav = computed(() => [
  { to: '/portal', label: t('Home', 'Inicio'), icon: 'M2.5 7L8 2.5 13.5 7v6.5h-4v-4h-3v4h-4z' },
  { to: '/portal/appointments', label: t('Appointments', 'Citas'), icon: 'M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2' },
  { to: '/portal/billing', label: t('Billing', 'Facturación'), icon: 'M2 4h12v8h-12zM2 7h12' },
  { to: '/portal/documents', label: t('Documents', 'Documentos'), icon: 'M4 2h5l3 3v9H4zM9 2v3.2h3' },
  { to: '/portal/messages', label: t('Messages', 'Mensajes'), icon: 'M2 3.5h12v8h-7l-3 2.5v-2.5h-2z' },
])

// Exact match for the index, prefix match for the rest -- otherwise /portal
// lights up on every page, since every path starts with it.
function isActive(to: string) {
  return to === '/portal' ? route.path === '/portal' : route.path.startsWith(to)
}

// The clinic's name arrives from an RPC, so the first paint has none. Until
// it does, the QuiroFlow mark stands in rather than initials derived from a
// placeholder -- "Q" for a clinic called anything else reads as a bug.
const clinicLabel = computed(() => settings.value.clinicName ?? t('Your clinic', 'Tu clínica'))
const clinicInitials = computed(() =>
  (settings.value.clinicName ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase(),
)
</script>

<template>
  <div class="min-h-screen bg-surface-page lg:flex">
    <aside class="hidden w-[240px] shrink-0 flex-col border-r border-line bg-surface-sidebar lg:flex">
      <div class="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-[11px] font-bold text-brand">
          <template v-if="clinicInitials">{{ clinicInitials }}</template>
          <img v-else src="/logo/quiroflow-mark.svg" alt="" class="h-4 w-4" />
        </span>
        <span class="min-w-0 flex-1 truncate text-[14.5px] font-[640] tracking-tightTitle text-ink-900">{{ clinicLabel }}</span>
      </div>

      <nav class="flex flex-1 flex-col gap-0.5 px-3">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex h-9 items-center gap-2.5 rounded-ctlSm px-[9px] text-[13.5px]"
          :class="isActive(item.to) ? 'bg-brand-tint font-semibold text-brand-text' : 'text-ink-600 hover:bg-surface-sidebarHover'"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path :d="item.icon" /></svg>
          <span>{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="border-t border-line p-3">
        <div class="flex items-center gap-2.5 px-[9px] py-1.5">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-[11px] font-semibold text-ink-600">
            {{ initials || '·' }}
          </span>
          <span class="min-w-0 flex-1 truncate text-[13px] text-ink-700">{{ fullName || t('Patient', 'Paciente') }}</span>
        </div>
        <button
          type="button"
          class="mt-1 flex h-8 w-full items-center gap-2.5 rounded-ctlSm px-[9px] text-[13px] text-ink-muted hover:bg-surface-sidebarHover hover:text-ink-700"
          @click="signOut"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 2.5H3.5v11H6M9.5 8h4.5M11.8 5.8L14 8l-2.2 2.2" /></svg>
          {{ t('Sign out', 'Cerrar sesión') }}
        </button>
      </div>
    </aside>

    <!-- Phone: the clinic's name stays on screen (it is the only thing
         telling a patient whose portal this is) and the nav moves to a
         thumb-reachable bar at the bottom. -->
    <header class="flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
      <span class="flex items-center gap-2">
        <span class="flex h-7 w-7 items-center justify-center rounded-ctlSm bg-brand-tint text-[10px] font-bold text-brand">
          <template v-if="clinicInitials">{{ clinicInitials }}</template>
          <img v-else src="/logo/quiroflow-mark.svg" alt="" class="h-3.5 w-3.5" />
        </span>
        <span class="text-[15px] font-[640] text-ink-900">{{ clinicLabel }}</span>
      </span>
      <button type="button" class="text-[13px] text-ink-muted hover:text-ink-700" @click="signOut">{{ t('Sign out', 'Cerrar sesión') }}</button>
    </header>

    <main class="min-w-0 flex-1 pb-20 lg:pb-0">
      <div class="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-9">
        <slot />
      </div>
    </main>

    <nav class="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <NuxtLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px]"
        :class="isActive(item.to) ? 'font-semibold text-brand-text' : 'text-ink-muted'"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path :d="item.icon" /></svg>
        {{ item.label }}
      </NuxtLink>
    </nav>
  </div>
</template>
