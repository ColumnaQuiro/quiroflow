import type { ReceptionistRun, ReceptionistToolUse } from '~/server/utils/receptionistModel'

// The record of one receptionist reply (receptionist_replies,
// 20261109201730_receptionist_replies.sql): what it did, which checks fired,
// why it did or did not go out, and what it cost. Read by the daily review
// and by whoever asks "is it better since the change?".
//
// Best-effort: a reply that went out must not fail because its record could
// not be written, so this logs and carries on.

export type ReplyOutcome =
  | 'sent'
  | 'drafted'
  | 'held_person'
  | 'held_diary'
  | 'held_limit'
  | 'held_past_time'
  | 'superseded'
  | 'no_reply'
  | 'refused'
  | 'send_failed'
  | 'voice_note'
  | 'minor'

export interface ReplyRecord {
  accountId: string
  conversationKey: string
  kind: 'lead' | 'patient'
  /** Whether it was allowed to send on its own at that moment. */
  mode: 'draft' | 'send'
  outcome: ReplyOutcome
  answersThrough: string | null
  run?: ReceptionistRun | null
  model?: string
  handedOver?: boolean
  /** When a hold ends ('held_person', 'held_diary'), for resumeHeldReplies. */
  heldUntil?: Date | null
  startedAt: number
}

/**
 * The tool inputs worth keeping: when, what and how, never who. A booking's
 * inputs carry the name, phone and email of whoever it is for, and a
 * hand-over's reason names them; none of that belongs in a log, and the
 * conversation already holds it.
 */
const KEPT_INPUTS = ['date', 'time', 'appointment_type', 'move_visit_on', 'visit_on', 'from_date', 'to_date', 'any_chiropractor', 'child_age', 'preference']

export function traceToolUses(uses: ReceptionistToolUse[]): { name: string; ok: boolean; input: Record<string, unknown> }[] {
  return uses.map((use) => ({
    name: use.name,
    ok: use.ok,
    input: Object.fromEntries(Object.entries(use.input ?? {}).filter(([key]) => KEPT_INPUTS.includes(key)).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 120) : value])),
  }))
}

export async function recordReply(service: any, record: ReplyRecord): Promise<void> {
  try {
    const run = record.run ?? null
    const { error } = await service.from('receptionist_replies').insert({
      account_id: record.accountId,
      conversation_key: record.conversationKey,
      kind: record.kind,
      mode: record.mode,
      outcome: record.outcome,
      answers_through: record.answersThrough,
      tool_uses: run ? traceToolUses(run.toolUses) : [],
      checks: run?.checks ?? [],
      handed_over: Boolean(record.handedOver ?? run?.handedOver),
      model: run ? record.model ?? null : null,
      rounds: run?.usage.rounds ?? null,
      input_tokens: run?.usage.inputTokens ?? null,
      output_tokens: run?.usage.outputTokens ?? null,
      cache_read_tokens: run?.usage.cacheReadTokens ?? null,
      cache_write_tokens: run?.usage.cacheWriteTokens ?? null,
      duration_ms: Math.max(0, Date.now() - record.startedAt),
      held_until: record.heldUntil ? record.heldUntil.toISOString() : null,
    })
    if (error) console.error('[receptionist] could not record the reply:', error.message)
  } catch (err) {
    console.error('[receptionist] could not record the reply:', (err as Error)?.message ?? err)
  }
}
