import { expect, it } from 'vitest'

// The harness itself, with a stand-in for the model: both prompts build,
// and the stand-in tools answer from the fixture. Free, and needs no key, so
// a broken harness shows up before anyone pays for a run that proves nothing.
import type Anthropic from '@anthropic-ai/sdk'
import { runScenario } from './harness'
import { TYPES } from './fixtures'

it('builds every kind of prompt and runs the tools without a model', async () => {
  const seen: unknown[] = []
  let round = 0
  const fake = { messages: { create: async (req: { system: { text: string }[]; tools?: { name: string }[] }) => {
    seen.push(req)
    round++
    if (round === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'book_appointment', input: { appointment_type: 'Ajuste Quiropráctico', date: '2026-11-18', time: '18:30' } }], usage: { input_tokens: 10, output_tokens: 5 } }
    if (round === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'cancel_appointment', input: { visit_on: '2026-11-19 17:30' } }], usage: { input_tokens: 10, output_tokens: 5 } }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Te he reservado el ajuste el miércoles 18 de noviembre a las 18:30 con Marta, y tu cita del jueves 19 a las 17:30 queda cancelada.' }], usage: { input_tokens: 10, output_tokens: 5 } }
  } } } as unknown as Anthropic
  const patient = await runScenario({ kind: 'patient', returning: true, booked: [{ at: '2026-11-19 17:30', type: TYPES.adjustment }], conversation: [{ from: 'them', text: 'hola' }] }, 'x', fake)
  expect(patient.tools.map((t) => [t.name, t.ok])).toEqual([['book_appointment', true], ['cancel_appointment', true]])
  round = 2
  const lead = await runScenario({ kind: 'lead', leadOrigin: { channel: 'facebook', source: 'Meta Ads', externalSource: 'facebook', campaign: null, ad: null }, conversation: [{ from: 'them', text: 'hola' }] }, 'x', fake)
  expect(lead.refused || lead.text.length > 0).toBe(true)
  const systemText = (seen[0] as { system: { text: string }[] }).system.map((b) => b.text).join('\n')
  expect(systemText).toContain('Clínica Demo')
  expect(systemText).toContain('Monday 2026-11-16')
})
