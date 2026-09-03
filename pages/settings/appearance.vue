<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const { preference, setPreference } = useTheme()
const { preference: langPreference, setPreference: setLangPreference } = useLang()
const t = useT()

const options = computed(() => [
  { value: 'light' as const, label: t('Light', 'Claro'), description: t('Always use the light theme.', 'Usar siempre el tema claro.') },
  { value: 'dark' as const, label: t('Dark', 'Oscuro'), description: t('Always use the dark theme.', 'Usar siempre el tema oscuro.') },
  { value: 'system' as const, label: t('System', 'Sistema'), description: t("Match this device's own light/dark setting.", 'Igualar el ajuste claro/oscuro de este dispositivo.') },
])

const languageOptions = [
  { value: 'en' as const, label: 'English', description: 'Show QuiroFlow in English.' },
  { value: 'es' as const, label: 'Español', description: 'Mostrar QuiroFlow en español.' },
]

const saving = ref(false)
const savingLang = ref(false)

async function choose(value: 'light' | 'dark' | 'system') {
  setPreference(value)
  saving.value = true
  await supabase.from('team_members').update({ theme_preference: value }).eq('id', store.teamMember!.id)
  if (store.teamMember) store.teamMember.theme_preference = value
  saving.value = false
}

async function chooseLanguage(value: 'en' | 'es') {
  setLangPreference(value)
  savingLang.value = true
  await supabase.from('team_members').update({ language_preference: value }).eq('id', store.teamMember!.id)
  if (store.teamMember) store.teamMember.language_preference = value
  savingLang.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Appearance', 'Apariencia')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[520px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t("This is your own preference -- it doesn't affect what anyone else on your team sees.", 'Esta es tu propia preferencia -- no afecta lo que ve el resto de tu equipo.') }}</p>

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

          <p class="mt-8 text-[13.5px] font-[560] text-ink-700">{{ t('Language', 'Idioma') }}</p>
          <p class="mt-1 text-[13px] text-ink-muted2">{{ t("This is your own preference -- it doesn't affect what anyone else on your team sees.", 'Esta es tu propia preferencia -- no afecta lo que ve el resto de tu equipo.') }}</p>

          <div class="mt-4 space-y-2">
            <button
              v-for="opt in languageOptions"
              :key="opt.value"
              type="button"
              class="flex w-full items-center justify-between rounded-card border p-4 text-left shadow-card"
              :class="langPreference === opt.value ? 'border-brand bg-brand-tint' : 'border-line bg-surface hover:bg-surface-subtle'"
              :disabled="savingLang"
              @click="chooseLanguage(opt.value)"
            >
              <div>
                <p class="text-[13.5px] font-medium text-ink-900">{{ opt.label }}</p>
                <p class="mt-0.5 text-[12.5px] text-ink-muted2">{{ opt.description }}</p>
              </div>
              <div
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                :class="langPreference === opt.value ? 'border-brand bg-brand' : 'border-line-control'"
              >
                <span v-if="langPreference === opt.value" class="h-2 w-2 rounded-full bg-white" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
