<script setup lang="ts">
const route = useRoute()
const { can, scope } = usePermission()

const allNavItems = [
  { label: 'Dashboard', to: '/dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', perm: () => scope('dashboard_scope') !== 'none' },
  { label: 'Calendar', to: '/calendar', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', perm: () => scope('calendar_scope') !== 'none' },
  { label: 'My Day', to: '/practitioner', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', perm: () => scope('calendar_scope') !== 'none' },
  { label: 'Patients', to: '/patients', icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4', perm: () => scope('patients_scope') !== 'none' },
  { label: 'Recalls', to: '/recalls', icon: 'M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114.6-4.6M20 15a8 8 0 01-14.6 4.6', perm: () => can('recalls_access') },
  { label: 'Billing', to: '/billing', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', perm: () => can('billing_access') },
  { label: 'Reports', to: '/reports', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2', perm: () => can('reports_access') },
  { label: 'Settings', to: '/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', perm: () => can('settings_access') },
]

const navItems = computed(() => allNavItems.filter((item) => item.perm()))

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <aside class="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white print:hidden">
    <div class="flex h-14 items-center gap-2 px-4">
      <NuxtLink to="/dashboard" class="flex items-center gap-2 text-lg font-semibold text-gray-900">
        <img src="/logo/quiroflow-mark.svg" alt="" class="h-5 w-5" />
        QuiroFlow
      </NuxtLink>
    </div>
    <nav class="flex-1 space-y-1 px-2 py-2">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium"
        :class="isActive(item.to) ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'"
      >
        <svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" :d="item.icon" />
        </svg>
        {{ item.label }}
      </NuxtLink>
    </nav>
  </aside>
</template>
