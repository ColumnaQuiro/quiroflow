<script setup lang="ts">
// "Get the app" as a card: the mark, one line of reason, the two buttons.
//
// Shared by the patient portal's home and the booking confirmation, because
// the pitch is the same in both places and only the wording around it
// differs. Both catch a patient who has just done something -- signed in,
// booked a visit -- and is the most likely they will ever be to install it.
const props = defineProps<{
  /** Spanish-only surfaces (the public booking page) pass this explicitly. */
  lang?: 'en' | 'es'
  /** Overrides the heading, so a clinic's own booking text override can win. */
  heading?: string
  /** Overrides the supporting line, same reason. */
  body?: string
}>()

const { preference } = useLang()
const t = (en: string, es: string) => ((props.lang ?? preference.value) === 'es' ? es : en)

const headingText = computed(() => props.heading || t('Get the QuiroFlow app', 'Descarga la app de QuiroFlow'))
const bodyText = computed(
  () =>
    props.body ||
    t(
      'Your appointments, documents and messages on your phone — and a reminder before every visit.',
      'Tus citas, documentos y mensajes en el móvil, y un recordatorio antes de cada visita.',
    ),
)
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-5 shadow-card">
    <div class="flex items-start gap-3.5">
      <img src="/logo/quiroflow-app-icon.svg" alt="" class="h-11 w-11 shrink-0 rounded-[10px]" />
      <div class="min-w-0">
        <h3 class="text-[15px] font-[640] tracking-tightTitle text-ink-900">{{ headingText }}</h3>
        <p class="mt-1 text-[13px] leading-relaxed text-ink-muted">{{ bodyText }}</p>
      </div>
    </div>
    <AppDownloadButtons :lang="lang" class="mt-4" />
  </section>
</template>
