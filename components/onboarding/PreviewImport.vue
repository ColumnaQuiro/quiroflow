<script setup lang="ts">
// The Import step's panel: what bringing a clinic's history across looks like,
// and the one thing it leaves to do afterwards.
//
// An import carries each visit's practitioner as the name the old software
// printed, not as a QuiroFlow login. Until that name is linked to someone on
// the team (Settings -> Team, "Imported names not linked") those visits sit
// in nobody's calendar column. The second card is here so that step is
// expected rather than discovered.
//
// The counts are invented, like everything in previewFixtures.ts, and the
// practitioner is the same vetted demo name the other panels use.
import type { ImportSource } from './previewFixtures'

const props = defineProps<{ source: ImportSource | null }>()

const t = useT()

const sourceName = computed(() =>
  props.source === 'practicehub' ? 'PracticeHub' : props.source === 'quirocitas' ? 'Quirocitas' : t('your previous software', 'tu programa anterior'),
)

const rows = computed(() => {
  // A CSV brings patients and nothing else, so the panel does not promise more.
  if (props.source === 'other') return [{ label: t('Patients', 'Pacientes'), count: t('1,240', '1240') }]
  return [
    { label: t('Patients', 'Pacientes'), count: t('1,240', '1240') },
    { label: t('Appointments', 'Citas'), count: t('9,315', '9315') },
    { label: t('Invoices and payments', 'Facturas y pagos'), count: t('4,082', '4082') },
    { label: t('Bonos', 'Bonos'), count: '96' },
    { label: t('Treatment notes', 'Notas de tratamiento'), count: t('6,871', '6871') },
  ]
})
</script>

<template>
  <OnboardingPreview
    :eyebrow="t('Optional', 'Opcional')"
    :title="source === 'none' ? t('Start empty, import whenever you like', 'Empieza de cero, importa cuando quieras') : t(`Your history, brought across from ${sourceName}`, `Tu historial, traído desde ${sourceName}`)"
    :body="
      t(
        'Patients first, then everything that hangs off them. Run it again before you switch over and it only adds what is new.',
        'Primero los pacientes, luego todo lo que cuelga de ellos. Si lo repites antes de cambiarte, solo añade lo nuevo.',
      )
    "
  >
    <OnboardingPreviewFragment>
      <div class="flex items-center gap-2.5 border-b border-line-divider px-4 py-[13px]">
        <span class="text-[13.5px] font-semibold text-ink-900">{{ t('Import', 'Importar') }}</span>
        <span class="truncate text-[12.5px] text-ink-muted">{{ sourceName }} → QuiroFlow</span>
        <span class="min-w-0 flex-1" />
        <span class="shrink-0 rounded-pill border border-success-border bg-success-bg px-2.5 py-[3px] text-[11.5px] font-semibold text-success-text">{{ t('Done', 'Hecho') }}</span>
      </div>
      <div v-for="row in rows" :key="row.label" class="flex items-center gap-3 border-b border-line-divider px-4 py-[11px] last:border-b-0">
        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-success-text">
          <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="min-w-0 flex-1 truncate text-[13.5px] text-ink-900">{{ row.label }}</span>
        <span class="shrink-0 text-[13.5px] font-semibold tabular-nums text-ink-900">{{ row.count }}</span>
      </div>
    </OnboardingPreviewFragment>

    <OnboardingPreviewFragment v-if="source !== 'other'">
      <div class="border-b border-line-divider px-4 py-[13px]">
        <p class="text-[13px] font-semibold text-ink-900">{{ t('Then: link imported practitioners to your team', 'Después: vincula los profesionales importados a tu equipo') }}</p>
        <p class="mt-0.5 text-[12px] text-ink-muted">{{ t('Their visits land in their own calendar column.', 'Sus visitas pasan a su propia columna de la agenda.') }}</p>
      </div>
      <div class="flex items-center gap-3 px-4 py-3">
        <span class="min-w-0 flex-1 truncate text-[13px] text-ink-700">
          «A. Esteve» <span class="text-ink-muted">· {{ t('6,204 visits', '6204 visitas') }}</span>
        </span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-ink-muted">
          <path d="M3 8H13M9.5 4.5L13 8L9.5 11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="flex h-[30px] shrink-0 items-center gap-1.5 rounded-ctl border border-brand-tintBorder bg-brand-tint px-2.5 text-[12.5px] font-semibold text-brand-text">
          Alba Esteve
        </span>
      </div>
    </OnboardingPreviewFragment>
  </OnboardingPreview>
</template>
