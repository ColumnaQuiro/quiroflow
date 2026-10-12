<script setup lang="ts">
// "Invita a un amigo", on the patient's home in the app and the portal: their
// own link to the clinic's booking page (my_referral_code), to share or copy,
// and what the clinic gives for it. A friend who books through it for the
// first time is recorded as referred by them (server/utils/bookingReferral.ts).
// Hidden while the clinic has the programme off.
const props = defineProps<{ patientId: string }>()

const t = useT()
const supabase = useSupabaseClient()
const info = ref<{ enabled: boolean; slug?: string; code?: string; reward?: string | null } | null>(null)
const copied = ref(false)

watch(
  () => props.patientId,
  async (id) => {
    if (!id) return
    const { data } = await supabase.rpc('my_referral_code', { p_patient_id: id })
    info.value = (data as typeof info.value) ?? null
  },
  { immediate: true },
)

// The web's own address on the portal; the app is not on one, so it uses
// where the web lives (the same base the app's API calls go to).
const base = computed(() => {
  const api = (useRuntimeConfig().public as { apiBase?: string }).apiBase
  return api || (import.meta.client ? window.location.origin : '')
})
const link = computed(() => (info.value?.enabled && info.value.slug && info.value.code ? `${base.value.replace(/\/$/, '')}/book/${info.value.slug}?ref=${info.value.code}` : ''))
const canShare = computed(() => import.meta.client && typeof navigator !== 'undefined' && 'share' in navigator)

async function share() {
  try {
    await navigator.share({ title: t('Book a visit', 'Reserva tu cita'), text: t('This is where I go -- book your first visit here:', 'Yo voy aquí, reserva tu primera visita:'), url: link.value })
  } catch {
    // Closing the share sheet is not an error worth showing.
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section v-if="link" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-referral">
    <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Invite a friend', 'Invita a un amigo') }}</p>
    <p class="mt-1.5 text-[14px] text-ink-900">{{ t('Share your link: when a friend books their first visit with it, we will know it was you.', 'Comparte tu enlace: cuando alguien reserve su primera visita con él, sabremos que fue gracias a ti.') }}</p>
    <p v-if="info?.reward" class="mt-1 text-[13px] font-medium text-brand-text" data-cy="patient-referral-reward">{{ info.reward }}</p>
    <p class="mt-2 truncate rounded-ctl bg-surface-subtle px-3 py-2 font-mono text-[12.5px] text-ink-700" data-cy="patient-referral-link">{{ link }}</p>
    <div class="mt-2.5 flex gap-2">
      <button v-if="canShare" type="button" class="min-h-10 flex-1 rounded-ctl bg-brand px-3 text-[13.5px] font-semibold text-white" data-cy="patient-referral-share" @click="share">{{ t('Share', 'Compartir') }}</button>
      <button type="button" class="min-h-10 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] font-medium text-ink-700" data-cy="patient-referral-copy" @click="copy">{{ copied ? t('Copied', 'Copiado') : t('Copy link', 'Copiar enlace') }}</button>
    </div>
  </section>
</template>
