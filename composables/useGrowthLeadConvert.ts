// Turning a lead into a patient -- the terminal action of the Growth tier,
// and the only one that writes a clinical record.
//
// The interesting case is not success. It is the lead who is already a
// patient: someone who came back through an ad, or whose partner booked
// under the same phone. Converting them blindly is how a clinic ends up with
// two records for one person, a split balance and a clinical history in two
// halves. So the API answers 409 with what it found, and this composable
// holds that answer until a person decides.

export interface DuplicateCandidate {
  id: string
  name: string
  reason: string
}

interface ConvertResult {
  patientId: string
  created: boolean
  alreadyConverted: boolean
}

export function useGrowthLeadConvert() {
  const converting = ref(false)
  /** Non-empty while a decision about a likely duplicate is outstanding. */
  const candidates = ref<DuplicateCandidate[]>([])
  const { showToast } = useToast()
  const t = useT()

  async function post(leadId: string, body: Record<string, unknown>) {
    return useStaffFetch<ConvertResult>(`/api/growth/leads/${leadId}/convert`, { method: 'POST', body })
  }

  /**
   * @returns the patient id once the lead is converted, or null when a
   * decision about a possible duplicate is still outstanding.
   */
  async function convert(leadId: string, body: Record<string, unknown> = {}): Promise<string | null> {
    converting.value = true
    try {
      const result = await post(leadId, body)
      candidates.value = []
      showToast(
        result.alreadyConverted
          ? t('That lead was already converted.', 'Ese contacto ya se había convertido.')
          : result.created
            ? t('Patient record created.', 'Ficha de paciente creada.')
            : t('Lead linked to the existing patient.', 'Contacto vinculado al paciente existente.'),
      )
      return result.patientId
    } catch (e) {
      // 409 is not a failure -- it is the API declining to guess. Anything
      // else is.
      const found = (e as { data?: { data?: { candidates?: DuplicateCandidate[] } }; statusCode?: number })
      if (found.statusCode === 409 && found.data?.data?.candidates?.length) {
        candidates.value = found.data.data.candidates
        return null
      }
      showToast(
        (e as { statusMessage?: string }).statusMessage
          ?? t('Could not convert that lead.', 'No se ha podido convertir el contacto.'),
        'error',
      )
      return null
    } finally {
      converting.value = false
    }
  }

  const linkToExisting = (leadId: string, patientId: string) => convert(leadId, { linkPatientId: patientId })
  const createAnyway = (leadId: string) => convert(leadId, { createAnyway: true })

  function dismissCandidates() {
    candidates.value = []
  }

  return { converting, candidates, convert, linkToExisting, createAnyway, dismissCandidates }
}
