<script setup lang="ts">
// "Para ti" on the patient's home, in the app and the portal: the articles
// their clinic sent them (learn_sends, read under the patient's own RLS),
// newest first, a new one marked until it is opened. Nothing at all when
// nothing was sent. Titles in the language on the patient's record, when the
// article has one (utils/learnContent.ts). Shared with mobile/, so no
// account store.
import { LEARN_TITLES_SELECT, learnTitleIn } from '../../utils/learnContent'

const props = defineProps<{ patientId: string; linkTo: (sendId: string) => string }>()

const t = useT()
const supabase = useSupabaseClient()

interface Item {
  id: string
  sent_at: string
  opened_at: string | null
  patients: { preferred_language: string | null } | null
  learn_articles: { title: string; title_en: string | null; title_fr: string | null; title_ca: string | null; minutes: number | null; video_url: string | null } | null
}
const items = ref<Item[]>([])
async function load() {
  const { data } = await supabase
    .from('learn_sends')
    .select(`id, sent_at, opened_at, patients(preferred_language), learn_articles(title, ${LEARN_TITLES_SELECT}, minutes, video_url)`)
    .eq('patient_id', props.patientId)
    .order('sent_at', { ascending: false })
    .limit(5)
  items.value = ((data as unknown as Item[] | null) ?? []).filter((i) => i.learn_articles)
}
watch(() => props.patientId, load, { immediate: true })
const day = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
</script>

<template>
  <section v-if="items.length" class="rounded-card border border-line bg-surface p-4" data-cy="patient-learn">
    <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('For you', 'Para ti') }}</h2>
    <ul class="mt-1 divide-y divide-line-row">
      <li v-for="i in items" :key="i.id">
        <NuxtLink :to="linkTo(i.id)" class="flex items-center gap-3 py-2.5" data-cy="patient-learn-item">
          <span class="min-w-0 flex-1">
            <span class="block text-[15px] font-semibold text-ink-900">{{ learnTitleIn(i.learn_articles!, i.patients?.preferred_language) }}</span>
            <span class="block text-[12.5px] text-ink-muted">{{ [i.learn_articles!.video_url ? t('Video', 'Vídeo') : null, i.learn_articles!.minutes ? `${i.learn_articles!.minutes} min` : null, day(i.sent_at)].filter(Boolean).join(' · ') }}</span>
          </span>
          <UiPill v-if="!i.opened_at" tone="brand" data-cy="patient-learn-new">{{ t('New', 'Nueva') }}</UiPill>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
