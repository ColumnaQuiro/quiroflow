// "Try Alba": the owner talking to their own configuration.
//
// Nothing here reaches a patient and nothing is booked -- which is the point.
// It is where a clinic finds out what its booking rules and escalation rules
// actually produce, before any of it is pointed at a real person.

export interface TestTurn {
  role: 'user' | 'assistant'
  content: string
}

export function useGrowthReceptionistTest() {
  const turns = ref<TestTurn[]>([])
  const thinking = ref(false)
  const unavailable = ref(false)
  // Who the owner is pretending to be. A real lead's origin comes from its
  // record (an ad form, a WhatsApp message); here it is chosen, so both
  // answers to "how much is it?" can be tried before either reaches anyone.
  const fromAd = ref(false)
  const t = useT()
  const { showToast } = useToast()

  async function send(text: string) {
    const message = text.trim()
    if (!message || thinking.value) return

    turns.value.push({ role: 'user', content: message })
    thinking.value = true
    try {
      const result = await useStaffFetch<{ available: boolean; reply: string; refused?: boolean }>(
        '/api/growth/receptionist/test-chat',
        // The whole conversation, because the API is stateless and the
        // receptionist has to remember what the patient already told it.
        { method: 'POST', body: { messages: turns.value, origin: fromAd.value ? 'ad' : 'unknown' } },
      )

      if (!result.available) {
        unavailable.value = true
        return
      }
      if (result.refused) {
        turns.value.push({
          role: 'assistant',
          content: t(
            'The model declined to answer that one. Nothing was sent anywhere.',
            'El modelo no ha querido responder a eso. No se ha enviado nada.',
          ),
        })
        return
      }
      turns.value.push({ role: 'assistant', content: result.reply })
    } catch (e) {
      showToast(serverMessage(e) ?? t('The model did not answer.', 'El modelo no ha respondido.'), 'error')
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

  return { turns, thinking, unavailable, fromAd, send, reset }
}
