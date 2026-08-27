<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const { preference, setPreference } = useTheme()

const options = [
  { value: 'light' as const, label: 'Light', description: 'Always use the light theme.' },
  { value: 'dark' as const, label: 'Dark', description: 'Always use the dark theme.' },
  { value: 'system' as const, label: 'System', description: "Match this device's own light/dark setting." },
]

const saving = ref(false)

async function choose(value: 'light' | 'dark' | 'system') {
  setPreference(value)
  saving.value = true
  await supabase.from('team_members').update({ theme_preference: value }).eq('id', store.teamMember!.id)
  if (store.teamMember) store.teamMember.theme_preference = value
  saving.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Appearance" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[520px] flex-1">
          <p class="text-[13px] text-ink-muted2">This is your own preference -- it doesn't affect what anyone else on your team sees.</p>

          <div class="mt-4 space-y-2">
            <button
              v-for="opt in options"
              :key="opt.value"
              type="button"
              class="flex w-full items-center justify-between rounded-card border p-4 text-left shadow-card"
              :class="preference === opt.value ? 'border-brand bg-brand-tint' : 'border-line bg-surface hover:bg-surface-subtle'"
              :disabled="saving"
              @click="choose(opt.value)"
            >
              <div>
                <p class="text-[13.5px] font-medium text-ink-900">{{ opt.label }}</p>
                <p class="mt-0.5 text-[12.5px] text-ink-muted2">{{ opt.description }}</p>
              </div>
              <div
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                :class="preference === opt.value ? 'border-brand bg-brand' : 'border-line-control'"
              >
                <span v-if="preference === opt.value" class="h-2 w-2 rounded-full bg-white" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
