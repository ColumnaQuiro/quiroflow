<script setup lang="ts">
import { PREVIEW_THREAD } from './previewFixtures'

// Step 3's panel: the reminder a patient actually receives.
//
// It is built from theme tokens rather than fixed colours, so picking Dark on
// the left turns this panel dark too -- the preference applies to the whole
// app the moment it is chosen, and this is the proof of that. The language
// choice swaps the thread's copy the same way.
const props = defineProps<{ practice: string; theme: 'light' | 'dark' | 'system'; language: 'en' | 'es' }>()

const t = useT()

const thread = computed(() => PREVIEW_THREAD[props.language])
const clinicName = computed(() => props.practice.trim() || (props.language === 'es' ? 'tu consulta' : 'your practice'))

const themeWord = computed(() =>
  props.theme === 'dark' ? t('Dark', 'Oscura') : props.theme === 'light' ? t('Light', 'Clara') : t('System', 'Del sistema'),
)
const languageWord = computed(() => (props.language === 'es' ? t('Spanish', 'español') : t('English', 'inglés')))

/** Splits the instruction line on its {confirm}/{change} holes so both words can be bolded. */
const instructionParts = computed(() => {
  const [before, rest] = thread.value.instruction.split('{confirm}')
  const [middle, after] = (rest ?? '').split('{change}')
  return { before, middle, after: after ?? '' }
})

const outboundParts = computed(() => {
  const [before, after] = thread.value.outbound.split('{clinic}')
  return { before, after: after ?? '' }
})
</script>

<template>
  <OnboardingPreview
    :eyebrow="t('Previewing your choices', 'Vista previa de tus elecciones')"
    :title="t(`${themeWord} interface, reminders in ${languageWord}`, `Interfaz ${themeWord.toLowerCase()}, recordatorios en ${languageWord}`)"
    :body="
      t(
        'Patients get the reminder in your practice language; replies land back in the appointment.',
        'Los pacientes reciben el recordatorio en el idioma de tu consulta; las respuestas vuelven a la cita.',
      )
    "
  >
    <OnboardingPreviewFragment :top="246" :width="700">
      <div class="flex items-center gap-2.5 border-b border-line-divider px-4 py-[13px]">
        <div class="flex h-7 w-7 items-center justify-center rounded-full border border-line-control bg-surface-subtle">
          <span class="text-[11px] font-semibold text-ink-500">LF</span>
        </div>
        <div class="flex-1">
          <div class="text-[13.5px] font-semibold text-ink-900">Lucía Ferrer</div>
          <div class="mt-0.5 text-[11.5px] text-ink-muted">WhatsApp · +34 600 00 00 00</div>
        </div>
        <span class="rounded-pill border border-line-control bg-surface-subtle px-2.5 py-[3px] text-[11.5px] font-semibold text-ink-muted">{{ thread.badge }}</span>
      </div>

      <div class="flex flex-col gap-3 p-4">
        <div class="flex justify-end">
          <div class="max-w-[430px] rounded-[11px] rounded-br-[3px] bg-brand px-3 py-2.5">
            <p class="text-[13px] leading-[1.55] text-white">
              {{ outboundParts.before }}<strong class="font-semibold">{{ clinicName }}</strong>{{ outboundParts.after }}
            </p>
            <p class="mt-2 text-[13px] leading-[1.55] text-white">
              {{ instructionParts.before }}<strong class="font-semibold">{{ thread.confirm }}</strong>{{ instructionParts.middle }}<strong class="font-semibold">{{ thread.change }}</strong>{{ instructionParts.after }}
            </p>
            <p class="mt-2 text-[11px] text-white/80">{{ thread.sentAt }}</p>
          </div>
        </div>

        <div class="flex justify-start">
          <div class="rounded-[11px] rounded-bl-[3px] border border-line-control bg-surface-subtle px-3 py-2.5">
            <p class="text-[13px] leading-[1.55] text-ink-700">{{ thread.reply }}</p>
            <p class="mt-1.5 text-[11px] text-ink-muted">{{ thread.replyAt }}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 rounded-[9px] border border-success-border bg-success-bg px-[11px] py-2.5">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-success-text">
            <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="text-[12.5px] font-semibold text-success-text">{{ thread.confirmed }}</span>
          <span class="text-[12.5px] text-ink-muted">{{ thread.confirmedDetail }}</span>
        </div>

        <div class="flex justify-end">
          <div class="max-w-[430px] rounded-[11px] rounded-br-[3px] bg-brand px-3 py-2.5">
            <p class="text-[13px] leading-[1.55] text-white">{{ thread.followUp }}</p>
          </div>
        </div>

        <div class="mt-1 flex items-center gap-2.5 border-t border-line-divider pt-3">
          <span class="text-[12px] text-ink-muted">{{ thread.alsoEmail }}</span>
          <span class="flex-1" />
          <span class="text-[12px] text-ink-muted">{{ thread.template }}</span>
        </div>
      </div>
    </OnboardingPreviewFragment>
  </OnboardingPreview>
</template>
