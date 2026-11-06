<script setup lang="ts">
// The people one login may switch between (composables/useFamily.ts): me
// first, then everyone the clinic has linked to me. The portal shows it in
// the sidebar's menu, the app in a bottom sheet; both pick from this.
const emit = defineEmits<{ select: [patientId: string] }>()
const t = useT()
const { people, active } = useFamily()

function describe(p: FamilyPerson) {
  if (p.isSelf) return t('You', 'Tú')
  const word = familyRelationWord(p, t)
  const reach = p.access === 'admin' ? t('visits and payments', 'citas y pagos') : null
  return [word, reach].filter(Boolean).join(' · ') || t('Family', 'Familiar')
}
</script>

<template>
  <ul class="flex flex-col gap-0.5" data-cy="family-list">
    <li v-for="p in people" :key="p.patientId">
      <button
        type="button"
        class="flex min-h-11 w-full items-center gap-3 rounded-ctlSm px-2.5 py-2 text-left hover:bg-surface-subtle"
        :class="active?.patientId === p.patientId ? 'bg-brand-tint' : ''"
        :aria-current="active?.patientId === p.patientId ? 'true' : undefined"
        :data-cy="`family-person-${p.firstName}`"
        @click="emit('select', p.patientId)"
      >
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold"
          :class="p.isSelf ? 'bg-surface-subtle text-ink-600' : 'bg-info-bg text-info-text'"
        >
          {{ personInitials(p) || '·' }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13.5px] font-medium text-ink-900">{{ personName(p) }}</span>
          <span class="block truncate text-[12px] text-ink-muted">{{ describe(p) }}</span>
        </span>
        <svg v-if="active?.patientId === p.patientId" class="shrink-0 text-brand-text" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </button>
    </li>
  </ul>
</template>
