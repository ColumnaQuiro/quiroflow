import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { loadQuirocitasMeta, loadQuirocitasSnapshot, quirocitasRecordStamps } from '~/server/utils/quirocitasSnapshotStore'
import { quirocitasLedgerMismatches, quirocitasReadState } from '~/utils/quirocitasRows'

// What the copy read from Quirocitas holds, for the Read screen and the step
// list -- counts only, never the records. `?counts=1` adds the totals the Read
// screen shows, which means loading the whole copy; without it this is two
// small reads, cheap enough for every visit to Settings > Import.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const accountId = teamMember.account_id
  const admin = serverSupabaseServiceRole<Database>(event)
  const meta = await loadQuirocitasMeta(admin, accountId)
  if (!meta) return null

  const stamps = await quirocitasRecordStamps(admin, accountId)
  const finished = meta.ledgerMonths.length > 0
  const pass = meta.passStartedAt
  const read = finished || !pass ? stamps.size : [...stamps.values()].filter((at) => at >= pass).length
  const base = {
    readAt: meta.readAt,
    state: { finished, read, total: meta.listTotal ?? null },
    failed: Object.keys(meta.failed).length,
    months: meta.ledgerMonths.length,
    ledgerRows: meta.ledger.length,
    firstMonth: meta.ledgerMonths[meta.ledgerMonths.length - 1]?.month ?? null,
    mismatched: quirocitasLedgerMismatches(meta).map((m) => m.month),
  }
  if (getQuery(event).counts !== '1') return { ...base, counts: null }

  const s = (await loadQuirocitasSnapshot(admin, accountId))!
  const records = Object.values(s.patients)
  // Same rule the import steps apply (quirocitasReadState), from the records.
  const state = quirocitasReadState(s)
  return {
    ...base,
    state,
    counts: {
      patients: records.length,
      appointments: records.reduce((a, r) => a + r.ficha.appointments.length, 0),
      notes: records.reduce((a, r) => a + r.history.visits.filter((v) => v.notes.trim()).length, 0),
      segments: records.reduce((a, r) => a + Object.keys(r.techniques).length, 0),
      bonos: new Set(records.flatMap((r) => r.ficha.bonos.map((b) => b.id))).size,
      invoices: new Set(records.flatMap((r) => r.invoices.map((i) => `${i.year}/${i.number}`))).size,
      files: records.reduce((a, r) => a + r.history.tests.length, 0),
    },
  }
})
