<script setup lang="ts">
// The shell every onboarding screen sits in: a form column on the left and a
// product preview on the right.
//
// The flow used to be a 384px card centred in an otherwise empty page, which
// left roughly three quarters of a desktop window doing nothing and gave a
// clinic no reason to trust the thing it was about to hand patient records
// to. The right panel does that work -- it shows the actual product, built
// from the app's own tokens, rather than a marketing illustration.
//
// Below lg the panel is not rendered at all. It is reassurance, not content:
// there is nothing in it a phone needs, and half-scaling it would only make
// the form harder to finish.
withDefaults(
  defineProps<{
    /**
     * Where the form block sits in the column. Short steps centre; step 2 is
     * tall enough that centring would push its buttons under the fold.
     */
    align?: 'center' | 'start'
  }>(),
  { align: 'center' },
)

const t = useT()
</script>

<template>
  <div class="flex min-h-screen bg-surface">
    <!-- ============ LEFT: the form column ============ -->
    <div
      class="flex min-h-screen w-full flex-col px-5 pb-5 pt-6 lg:w-[53%] lg:shrink-0 lg:px-10 lg:pb-11 lg:pt-14 xl:px-[124px]"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
    >
      <div class="mx-auto flex w-full max-w-[515px] flex-1 flex-col">
        <!-- Brand first: the mark is what tells a clinic whose signup this is. -->
        <div class="flex items-center gap-[9px]">
          <img src="/logo/quiroflow-mark.svg" alt="" class="h-[26px] w-[26px]" />
          <span class="text-[16px] font-semibold tracking-tightTitle text-ink-900">QuiroFlow</span>
        </div>

        <div class="mt-6 lg:mt-10">
          <slot name="stepper" />
        </div>

        <div
          class="flex flex-1 flex-col py-5 lg:py-7"
          :class="align === 'center' ? 'justify-center' : 'justify-start'"
        >
          <slot name="heading" />
          <slot name="form" />
        </div>

        <!-- Trust line. Pinned to the bottom of the column by the flex-1 above,
             which on a phone means the bottom of the viewport. -->
        <div class="mt-auto border-t border-line-divider pt-3.5 lg:pt-4">
          <slot name="trust">
            <p class="text-[12px] leading-relaxed text-ink-muted lg:text-[12.5px]">
              {{
                t(
                  'Patient records stored in the EU under GDPR · 30-day trial, no card required · Cancel anytime.',
                  'Historiales de pacientes alojados en la UE conforme al RGPD · 30 días de prueba, sin tarjeta · Cancela cuando quieras.',
                )
              }}
            </p>
          </slot>
        </div>
      </div>
    </div>

    <!-- ============ RIGHT: product preview ============ -->
    <div class="relative hidden flex-1 overflow-hidden border-l border-line bg-surface-page lg:block">
      <slot name="preview" />
      <!-- Closes the crop, so the fragment reads as cropped rather than cut off. -->
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 bottom-0 h-[150px]"
        style="background: linear-gradient(to bottom, rgb(var(--color-surface-page) / 0), rgb(var(--color-surface-page)) 78%)"
      />
    </div>
  </div>
</template>
