// "Try Alba": the owner talking to their own configuration.
//
// Nothing here reaches a patient and nothing is booked -- which is the point.
// It is where a clinic finds out what its booking rules and escalation rules
// actually produce, before any of it is pointed at a real person.

export type TestScenario = 'new' | 'ad' | 'existing'

/** What the receptionist did while writing one reply, as the panel shows it. */
export interface TestTrace {
  /** The free times it looked up, one entry per lookup. */
  lookups: { detail: string | null; ok: boolean }[]
  /** It would have handed the conversation to a person, and why. */
  handedOver: string | null
}

export interface TestTurn {
  role: 'user' | 'assistant'
  content: string
  /** On the receptionist's turns: the model declined, or judged no reply was needed. */
  outcome?: 'refused' | 'no_reply'
  trace?: TestTrace
}

interface TestReply {
  available: boolean
  reply: string
  refused?: boolean
  noReply?: boolean
  handedOver?: string | null
  trace?: { name: string; detail: string | null; ok: boolean }[]
}

export function useGrowthReceptionistTest() {
  const turns = ref<TestTurn[]>([])
  const thinking = ref(false)
  const unavailable = ref(false)
  // Who the owner is pretending to be. A real lead's origin comes from its
  // record (an ad form, a WhatsApp message); here it is chosen, so both
  // answers to "how much is it?" can be tried before either reaches anyone,
  // and a returning patient's reply (never a first visit) alongside them.
  const scenario = ref<TestScenario>('new')
  const { showToast } = useToast()

  async function send(text: string) {
    const message = text.trim()
    if (!message || thinking.value) return

    turns.value.push({ role: 'user', content: message })
    thinking.value = true
    try {
      const result = await useStaffFetch<TestReply>(
        '/api/growth/receptionist/test-chat',
        // The whole conversation, because the API is stateless and the
        // receptionist has to remember what the patient already told it.
        // Only the words go: a turn's trace is the panel's, not the model's.
        { method: 'POST', body: { messages: turns.value.map((t) => ({ role: t.role, content: t.content })), scenario: scenario.value } },
      )

      if (!result.available) {
        unavailable.value = true
        return
      }
      const trace: TestTrace = {
        lookups: (result.trace ?? []).filter((use) => use.name === 'find_free_times').map((use) => ({ detail: use.detail, ok: use.ok })),
        handedOver: result.handedOver ?? null,
      }
      if (result.refused) {
        turns.value.push({ role: 'assistant', content: '', outcome: 'refused', trace })
        return
      }
      if (result.noReply) {
        turns.value.push({ role: 'assistant', content: '', outcome: 'no_reply', trace })
        return
      }
      turns.value.push({ role: 'assistant', content: result.reply, trace })
    } catch (e) {
      showToast(serverMessage(e) ?? useT()('The model did not answer.', 'El modelo no ha respondido.'), 'error')
      // The unanswered question is removed rather than left hanging, so a
      // retry does not send it twice.
      turns.value.pop()
    } finally {
      thinking.value = false
    }
  }

  function reset() {
    turns.value = []
  }

  return { turns, thinking, unavailable, scenario, send, reset }
}
