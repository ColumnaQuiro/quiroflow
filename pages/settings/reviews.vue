<script setup lang="ts">
// Settings > Reviews: the clinic's Google review link, which the
// {{google_review_link}} merge field fills in. The review-request automation
// (appointment.review_request) sends patients there, and so does the
// satisfaction check when a patient answers 4 or 5 (satisfactionSurvey.ts).
//
// It was under Settings > Messages > "Details messages use", where nobody
// setting up reviews would look. It is a page of its own rather than a field
// on Growth > Reputation because that page is part of Growth and review
// requests are not: a clinic without Growth sends them too, and has to be
// able to set where they point. Saved under communication_config, as before.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const url = ref('')
const savedUrl = ref('')
const loading = ref(true)
const saving = ref(false)
const dirty = computed(() => url.value.trim() !== savedUrl.value)

async function load() {
  const { data } = await supabase.from('accounts').select('google_review_url').eq('id', store.accountId!).maybeSingle()
  url.value = data?.google_review_url ?? ''
  savedUrl.value = url.value
  loading.value = false
}
onMounted(load)

// A link patients are sent to has to open: "g.page/r/..." without the scheme
// becomes a relative link in an email.
const invalid = computed(() => {
  const value = url.value.trim()
  return value !== '' && !/^https?:\/\/\S+$/i.test(value)
})

async function save() {
  if (invalid.value) {
    showToast(t('The link has to start with https://', 'El enlace tiene que empezar por https://'), 'error')
    return
  }
  saving.value = true
  const value = url.value.trim()
  const { error } = await supabase.from('accounts').update({ google_review_url: value || null }).eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  url.value = value
  savedUrl.value = value
  showToast(t('Saved', 'Guardado'))
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Reviews', 'Reseñas')">
      <span v-if="dirty" class="text-[13px] text-ink-muted">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
      <UiBtn variant="primary" data-cy="reviews-save" :disabled="saving || loading || !dirty" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="reviews-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Where patients are sent to leave you a review.', 'Adónde se envía a los pacientes para que te dejen una reseña.') }}
          </p>

          <section aria-labelledby="h-google" class="overflow-hidden rounded-card border border-line bg-surface">
            <h2 id="h-google" class="px-[18px] pb-2 pt-4 text-[16px] font-bold text-ink-900">Google</h2>
            <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
              <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                <label for="review-url" class="text-[14.5px] font-bold text-ink-900">{{ t('Google review link', 'Enlace de reseñas de Google') }}</label>
                <span class="text-[13px] leading-snug text-ink-500">
                  {{ t('Google Business Profile gives it to you under "Ask for reviews".', 'Te lo da tu Perfil de Empresa de Google, en "Pedir reseñas".') }}
                </span>
              </div>
              <UiSkeleton v-if="loading" class="h-9 w-full rounded-ctl sm:w-[320px]" />
              <input
                v-else
                id="review-url"
                v-model="url"
                type="url"
                inputmode="url"
                data-cy="review-url"
                placeholder="https://g.page/r/…/review"
                :aria-invalid="invalid || undefined"
                class="h-9 w-full rounded-ctl border bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11 sm:w-[320px]"
                :class="invalid ? 'border-danger-text' : 'border-line-control'"
              />
            </div>
            <p class="border-t border-line-row px-[18px] py-3 text-[13px] leading-snug text-ink-500">
              {{ t('Used by the review request and the satisfaction check in', 'Lo usan la solicitud de reseña y la pregunta de satisfacción de') }}
              <NuxtLink to="/automations" class="font-semibold text-brand-text hover:underline">{{ t('Automations', 'Automatizaciones') }}</NuxtLink>{{ t(', and by the "Google review link" field in any message. The reviews themselves are in', ', y el campo "Enlace de reseña de Google" de cualquier mensaje. Las reseñas en sí están en') }}
              <NuxtLink to="/growth/reputation" class="font-semibold text-brand-text hover:underline">{{ t('Growth › Reputation', 'Growth › Reputación') }}</NuxtLink>.
            </p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
