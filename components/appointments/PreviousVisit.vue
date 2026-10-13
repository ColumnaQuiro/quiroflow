<script setup lang="ts">
import { parseVisitNote } from '../../utils/visitNote'
import { listingSummary, sideLettersFor, type Listings } from '../../utils/spinalListings'

// The patient's previous visit beside today's (My Day on the web, the staff
// app's visit screen): the last one before this with a note or a listing --
// its listing with "Use today", and its note section by section, each with
// "Bring over" into today's note. Reading only; what is brought over is
// today's to edit. Under the same RLS as every read of notes and listings.
type Section = 'Subjective' | 'Objective' | 'Action' | 'Plan'
const props = defineProps<{ appointmentId: string; editable: boolean }>()
const emit = defineEmits<{ bring: [section: Section | 'Note', text: string]; useListings: [listings: Listings] }>()

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const found = ref<{ startsAt: string; type: string | null; practitioner: string | null; body: string | null; listings: Listings | null } | null>(null)

interface Appt { id: string; starts_at: string; appointment_types: { name: string } | null; team_members: { full_name: string } | null }

async function load() {
  loading.value = true
  found.value = null
  const { data: me } = await supabase.from('appointments').select('patient_id, starts_at').eq('id', props.appointmentId).maybeSingle()
  const cur = me as { patient_id: string | null; starts_at: string } | null
  if (cur?.patient_id) {
    const { data: before } = await supabase
      .from('appointments')
      .select('id, starts_at, appointment_types(name), team_members(full_name)')
      .eq('patient_id', cur.patient_id)
      .lt('starts_at', cur.starts_at)
      .neq('status', 'cancelled')
      .is('deleted_at', null)
      .order('starts_at', { ascending: false })
      .limit(20)
    const appts = (before as unknown as Appt[] | null) ?? []
    const ids = appts.map((a) => a.id)
    if (ids.length) {
      const [{ data: notes }, { data: lists }] = await Promise.all([
        supabase.from('visit_notes').select('appointment_id, body, created_at').in('appointment_id', ids).order('created_at', { ascending: false }),
        supabase.from('visit_listings').select('appointment_id, listings').in('appointment_id', ids),
      ])
      const noteBy = new Map<string, string>()
      for (const n of (notes as { appointment_id: string; body: string }[] | null) ?? []) if (!noteBy.has(n.appointment_id) && n.body?.trim()) noteBy.set(n.appointment_id, n.body)
      const listBy = new Map(((lists as { appointment_id: string; listings: Listings }[] | null) ?? []).filter((l) => Object.keys(l.listings ?? {}).length).map((l) => [l.appointment_id, l.listings]))
      const hit = appts.find((a) => noteBy.has(a.id) || listBy.has(a.id))
      if (hit) found.value = { startsAt: hit.starts_at, type: hit.appointment_types?.name ?? null, practitioner: hit.team_members?.full_name ?? null, body: noteBy.get(hit.id) ?? null, listings: listBy.get(hit.id) ?? null }
    }
  }
  loading.value = false
}
watch(() => props.appointmentId, load, { immediate: true })

const SECTIONS: Section[] = ['Subjective', 'Objective', 'Action', 'Plan']
const LABEL = computed<Record<Section | 'Note', string>>(() => ({ Subjective: t('Subjective', 'Subjetivo'), Objective: t('Objective', 'Objetivo'), Action: t('Action', 'Acción'), Plan: t('Plan', 'Plan'), Note: t('Note', 'Nota') }))
// Its note in sections, or as one block when it was written as free text.
const parts = computed<{ key: Section | 'Note'; text: string }[]>(() => {
  const body = found.value?.body
  if (!body) return []
  const parsed = parseVisitNote(body)
  if (!parsed.structured) return [{ key: 'Note', text: body.trim() }]
  return SECTIONS.map((k) => ({ key: k, text: parsed.sections.find((s) => s.label === k)?.text?.trim() ?? '' })).filter((p) => p.text)
})
const summary = computed(() => listingSummary(found.value?.listings, (l) => l, sideLettersFor(t)))
const heading = computed(() => {
  const f = found.value
  if (!f) return ''
  const day = new Date(f.startsAt).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
  return [day, f.type, f.practitioner].filter(Boolean).join(' · ')
})
</script>

<template>
  <section class="rounded-card border border-line bg-surface-subtle2 p-4 shadow-card" data-cy="previous-visit">
    <h2 class="text-[13.5px] font-semibold text-ink-900">{{ t('Last visit', 'Visita anterior') }}</h2>
    <div v-if="loading" class="mt-2 space-y-2"><UiSkeleton class="h-3.5 w-40 rounded-ctlSm" /><UiSkeleton class="h-3 w-full rounded-ctlSm" /></div>
    <p v-else-if="!found" class="mt-1 text-[12.5px] text-ink-muted" data-cy="previous-visit-none">{{ t('No earlier visit with a note or a listing.', 'Ninguna visita anterior con nota o listado.') }}</p>
    <template v-else>
      <p class="mt-0.5 text-[12px] text-ink-muted">{{ heading }}</p>
      <div v-if="summary" class="mt-3 rounded-ctl border border-line bg-surface px-3 py-2" data-cy="previous-visit-listing">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Listing', 'Listado') }}</span>
          <button v-if="editable" type="button" class="text-[12px] font-semibold text-brand-text" data-cy="previous-visit-use-listing" @click="emit('useListings', { ...found.listings! })">{{ t('Use today', 'Usar hoy') }}</button>
        </div>
        <p class="mt-1 text-[13px] font-semibold text-ink-900">{{ summary }}</p>
      </div>
      <div v-for="p in parts" :key="p.key" class="mt-3" data-cy="previous-visit-section">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ LABEL[p.key] }}</span>
          <button v-if="editable" type="button" class="text-[12px] font-semibold text-brand-text" :data-cy="`previous-visit-bring-${p.key}`" @click="emit('bring', p.key, p.text)">{{ t('Bring over', 'Traer') }}</button>
        </div>
        <p class="mt-1 whitespace-pre-line text-[13px] leading-snug text-ink-700">{{ p.text }}</p>
      </div>
    </template>
  </section>
</template>
