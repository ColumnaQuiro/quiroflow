// The lead drawer's contents, now fetched per lead.
//
// The timeline is the argument the whole Growth tier makes -- a form
// submission, the AI's WhatsApp conversation, what it concluded, the
// appointment it put in the real clinic calendar, the reminder, the visit --
// so it arrives as one ordered list of typed entries rather than separate
// per-source feeds a screen would have to interleave.

export type LeadTimelineKind = 'form' | 'conversation' | 'qualification' | 'appointment' | 'reminder' | 'note' | 'stage_change'

export interface LeadMessage {
  from: 'ai' | 'lead' | 'staff'
  text: string
}

export interface LeadTimelineEntry {
  id: string
  kind: LeadTimelineKind
  title: string
  time: string
  detail?: string | null
  /**
   * The parts that differ per kind, stored as jsonb and passed through by the
   * API: a transcript for `conversation`, the verdict for `qualification`,
   * the slot for `appointment`. Narrowed here rather than in the template so
   * the drawer reads one shape.
   */
  body?: {
    messages?: LeadMessage[]
    verdict?: string
    slot?: string
    slotDetail?: string
  } | null
}

export interface LeadAttributionRow {
  label: string
  value: string
}

export interface GrowthLeadDetail {
  id: string
  reference: string
  name: string
  initials: string
  createdAt: string
  aiHandling: boolean
  stage: string
  stageKey: string
  source: string
  value: string
  owner: string
  patientId: string | null
  contact: string[]
  attribution: LeadAttributionRow[]
  /** Consent lines. Not stored yet -- see the note in the drawer. */
  consent: string[]
  timeline: LeadTimelineEntry[]
}

export function useGrowthLeadDetail() {
  const lead = ref<GrowthLeadDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadLead(id: string) {
    loading.value = true
    error.value = null
    // Cleared rather than left in place: the drawer opens immediately, and
    // showing the previous lead's timeline under the new lead's name for a
    // few hundred milliseconds is worse than showing a spinner.
    lead.value = null
    try {
      lead.value = await useStaffFetch<GrowthLeadDetail>(`/api/growth/leads/${id}`)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load that lead'
    } finally {
      loading.value = false
    }
  }

  function close() {
    lead.value = null
    error.value = null
  }

  return { lead, loading, error, loadLead, close }
}
