<script setup lang="ts">
import { appStoreUrl, playStoreUrl } from '~/utils/appLinks'

// The two store buttons, shaped like the badges patients already recognise:
// small line above, store name below, mark on the left.
//
// Drawn rather than served as Apple's and Google's badge images, for two
// reasons. The badge artwork is a fixed-colour bitmap, so on a dark theme a
// black badge sits in a black card and vanishes; these are painted in
// `ink-900` on `surface`, the same two tokens the rest of the app uses, so
// they invert with everything else -- black on white in the light theme,
// white on near-black in the dark one. And a path stays sharp at any density,
// which a 3x PNG does not on the phones this is mostly read on.
//
// Both marks are monochrome on purpose. Apple's is monochrome by definition,
// Google's has an official monochrome variant, and using both makes the pair
// read as one set instead of two borrowed logos.
const props = withDefaults(
  defineProps<{
    /**
     * Overrides the viewer's own language. The public booking page is
     * Spanish-only regardless of who is looking at it (it is the patient
     * reading, not the staff member whose preference useT() follows), so it
     * passes 'es' explicitly.
     */
    lang?: 'en' | 'es'
    size?: 'md' | 'lg'
  }>(),
  { size: 'md' },
)

const { preference } = useLang()
const lang = computed(() => props.lang ?? preference.value)
function t(en: string, es: string) {
  return lang.value === 'es' ? es : en
}

// Null while the App Store's numeric ID is still unset -- see utils/appLinks.
// Better one button than a second one that lands the patient on a 404.
const ios = computed(() => appStoreUrl())
const android = playStoreUrl()

const boxClass = computed(() =>
  props.size === 'lg'
    ? 'h-[54px] gap-3 px-4 [&_.store-sub]:text-[11px] [&_.store-name]:text-[17px]'
    : 'h-12 gap-2.5 px-3.5 [&_.store-sub]:text-[10px] [&_.store-name]:text-[15px]',
)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <a
      v-if="ios"
      :href="ios"
      target="_blank"
      rel="noopener"
      class="inline-flex shrink-0 items-center rounded-ctl bg-ink-900 text-surface transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      :class="boxClass"
      :aria-label="t('Download QuiroFlow on the App Store', 'Descargar QuiroFlow en el App Store')"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" class="h-[22px] w-[22px] shrink-0" aria-hidden="true">
        <path
          d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
        />
      </svg>
      <span class="flex flex-col items-start leading-none">
        <span class="store-sub opacity-70">{{ t('Download on the', 'Descárgalo en el') }}</span>
        <span class="store-name mt-[3px] font-[620] tracking-tightTitle">App Store</span>
      </span>
    </a>

    <a
      :href="android"
      target="_blank"
      rel="noopener"
      class="inline-flex shrink-0 items-center rounded-ctl bg-ink-900 text-surface transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      :class="boxClass"
      :aria-label="t('Get QuiroFlow on Google Play', 'Consigue QuiroFlow en Google Play')"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" class="h-[21px] w-[21px] shrink-0" aria-hidden="true">
        <path d="M4.2 2.3a.9.9 0 0 1 1.35-.78l14.9 9.7a.9.9 0 0 1 0 1.56l-14.9 9.7a.9.9 0 0 1-1.35-.78V2.3Z" />
      </svg>
      <span class="flex flex-col items-start leading-none">
        <span class="store-sub opacity-70">{{ t('Get it on', 'Disponible en') }}</span>
        <span class="store-name mt-[3px] font-[620] tracking-tightTitle">Google Play</span>
      </span>
    </a>
  </div>
</template>
