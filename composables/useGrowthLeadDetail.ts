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
  occurredAt?: string
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
  key?: string
  label: string
  value: string
}

export interface GrowthLeadDetail {
  id: string
  reference: string
  name: string
  initials: string
  createdAt: string
  createdAtIso?: string
  aiHandling: boolean
  stage: string
  stageKey: string
  source: string
  value: string
  /** The lead's own estimated value; null when it has none (and `value` shows the account's default, if any). */
  valueCents: number | null
  valueIsDefault: boolean
  owner: string
  ownerName?: string | null
  patientId: string | null
  /** For the drawer's Call button; also the first line of `contact`. */
  phone: string | null
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
  const t = useT()
  const { preference } = useLang()
  const { showToast } = useToast()

  // The API's English words around the figures, in the reader's language
  // (utils/growthLeadWords.ts). Older responses without the raw fields keep
  // what the server wrote.
  function worded(raw: GrowthLeadDetail): GrowthLeadDetail {
    const locale = preference.value === 'es' ? 'es-ES' : 'en-GB'
    return {
      ...raw,
      createdAt: raw.createdAtIso
        ? t(
            `created ${new Date(raw.createdAtIso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`,
            `creado el ${new Date(raw.createdAtIso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`,
          )
        : raw.createdAt,
      stage: growthLeadStageTitle(raw.stageKey, t, raw.stage),
      source: growthLeadSource(raw.source, t),
      owner: raw.ownerName !== undefined ? (raw.ownerName ?? t('Unassigned', 'Sin asignar')) : raw.owner,
      attribution: raw.attribution.map((row) => ({ ...row, label: growthLeadAttributionLabel(row.key, t, row.label) })),
      timeline: raw.timeline.map((entry) => ({
        ...entry,
        time: entry.occurredAt
          ? new Date(entry.occurredAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          : entry.time,
      })),
    }
  }

  async function loadLead(id: string) {
    loading.value = true
    error.value = null
    // Cleared rather than left in place: the drawer opens immediately, and
    // showing the previous lead's timeline under the new lead's name for a
    // few hundred milliseconds is worse than showing a spinner.
    lead.value = null
    try {
      lead.value = worded(await useStaffFetch<GrowthLeadDetail>(`/api/growth/leads/${id}`))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load that lead'
      // Said on screen: the drawer closes when this fails, and nothing else
      // read `error`, so a lead that would not open simply did nothing.
      showToast(t('Could not open that lead. Try again.', 'No se ha podido abrir ese lead. Inténtalo de nuevo.'), 'error')
    } finally {
      loading.value = false
    }
  }

  // After an edit in the open drawer: fetched in place, without blanking the
  // drawer the way opening a different lead has to.
  async function refreshLead() {
    if (!lead.value) return
    try {
      lead.value = worded(await useStaffFetch<GrowthLeadDetail>(`/api/growth/leads/${lead.value.id}`))
    } catch {
      // The drawer keeps what it showed; the board reload says the rest.
    }
  }

  function close() {
    lead.value = null
    error.value = null
  }

  return { lead, loading, error, loadLead, refreshLead, close }
}
