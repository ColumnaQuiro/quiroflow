// The leads pipeline, now read from the database.
//
// This file used to serve the design's worked example from a module-level
// fixture. The interfaces below are unchanged from that version on purpose:
// the board, the columns and the cards were built against them, so swapping
// the source was a change here and nowhere else. That was the point of the
// seam.

/** Short channel tag rendered on the card. Formatted by the API. */
export type LeadChannel = string

export interface GrowthLead {
  id: string
  name: string
  channel: LeadChannel
  source: string
  /** The AI receptionist is mid-conversation with this person right now. */
  aiHandling?: boolean
  /** Appointment line shown in green -- booked, attended, or converted. */
  appointment?: string
  timeInStage: string
  value: string
}

export interface GrowthLeadColumn {
  key: string
  title: string
  /** Total in the stage, which can exceed cards.length -- see `more`. */
  count: number
  value: string
  cards: GrowthLead[]
  /** "+16 more" footer where the stage holds more than the board renders. */
  more?: string
  /** Shown instead of cards when the stage is genuinely empty. */
  emptyTitle?: string
  emptyDetail?: string
}

export interface GrowthLeadsSummary {
  openLeads: number
  estimatedValue: string
  handledByAi: number
}

interface LeadsResponse {
  columns: GrowthLeadColumn[]
  summary: GrowthLeadsSummary
}

// The one stage that explains itself when empty, because an empty Lost column
// is good news rather than missing data. Copy lives here rather than in the
// API: it is presentation, and it needs translating.
const EMPTY_STAGE_COPY: Record<string, { title: string; detail: string }> = {
  lost: { title: 'No lost leads', detail: 'Nothing closed out in the last 30 days.' },
}

export function useGrowthLeads() {
  const columns = ref<GrowthLeadColumn[]>([])
  const summary = ref<GrowthLeadsSummary | null>(null)
  const loading = ref(true)
  // Strictly a *load* failure, because the page renders this instead of the
  // board. A failed drag must never set it: one rejected move would blank the
  // whole pipeline, which is a far worse outcome than the move not happening.
  const error = ref<string | null>(null)
  const { showToast } = useToast()
  const t = useT()

  async function load() {
    try {
      const data = await useStaffFetch<LeadsResponse>('/api/growth/leads')
      columns.value = data.columns.map((column) => {
        const empty = EMPTY_STAGE_COPY[column.key]
        return empty ? { ...column, emptyTitle: empty.title, emptyDetail: empty.detail } : column
      })
      summary.value = data.summary
      error.value = null
    } catch {
      // Deliberately not e.message: $fetch throws a FetchError whose message
      // is '[GET] "/api/growth/leads": 500 Internal Server Error'. That
      // belongs in the console, which already has it, not on the screen of
      // someone trying to work a pipeline.
      error.value = t('Could not load leads. Refresh to try again.', 'No se han podido cargar los contactos. Actualiza para reintentar.')
    } finally {
      loading.value = false
    }
  }

  onMounted(load)

  /**
   * Moves a lead into `toKey`. The board is updated first and the request
   * follows, because a drag that visibly snaps back while a round trip
   * completes feels broken -- and reverted on failure, because a drag that
   * silently did nothing is worse.
   */
  async function moveLead(leadId: string, toKey: string) {
    const from = columns.value.find((c) => c.cards.some((card) => card.id === leadId))
    const to = columns.value.find((c) => c.key === toKey)
    if (!from || !to || from === to) return

    const index = from.cards.findIndex((card) => card.id === leadId)
    const [lead] = from.cards.splice(index, 1)
    if (!lead) return

    to.cards.unshift({ ...lead, timeInStage: 'just now' })
    from.count = Math.max(0, from.count - 1)
    to.count += 1

    try {
      await useStaffFetch(`/api/growth/leads/${leadId}`, { method: 'PATCH', body: { stage: toKey } })
    } catch {
      // Put it back exactly where it was rather than reloading the board:
      // a reload would also discard any other drag made in the meantime.
      const moved = to.cards.findIndex((card) => card.id === leadId)
      // Guarded: splice(-1, 1) would quietly delete the last card in the
      // column instead of doing nothing.
      if (moved !== -1) to.cards.splice(moved, 1)
      from.cards.splice(index, 0, lead)
      from.count += 1
      to.count = Math.max(0, to.count - 1)
      // A toast, not the page-level error: the board is still perfectly
      // usable, and the one thing that failed has already been undone.
      showToast(t('Could not move that lead. It has been put back.', 'No se ha podido mover el contacto. Se ha devuelto a su sitio.'), 'error')
    }
  }

  return { columns, summary, loading, error, moveLead, reload: load }
}
