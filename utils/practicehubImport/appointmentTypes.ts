import { TYPE_STAGES } from '~/utils/appointmentTypes'
import { formatEur } from '~/utils/billing'
import { practiceHubPriceToWrite, practiceHubTypePrice, type PracticeHubBillableItem } from '~/utils/practicehubTypePrices'
import { byExactName, practiceHubTypesHere, readAllForAccount } from '~/utils/practicehubImport/appointments'
import { practiceHubList, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'

// The Appointment types step of a PracticeHub import, run on the server from
// the copy in import_snapshots: components/import/PracticeHubAppointmentTypesImporter.vue
// without the screen. It brings PracticeHub's types across (with their
// length, colour and, where PracticeHub 2.0 gives one, price) and points every
// visit already here at the type PracticeHub says it was.
//
// In a full sync it runs AFTER Appointments, which leaves a visit whose type
// name is not here yet with no type: this step creates the type and links
// the visit. Run twice, it finds the types it created by name, fills in only
// prices still at 0, and re-points only the visits whose type differs.

export interface PHAppointmentType { id: number | string; name: string; active?: number | boolean | null; duration?: number | null; color?: string | null }
export interface PHTypedAppointment { id: number | string; appointment_type_id: number | string | null }

// Best-effort mapping from PracticeHub's own type names to the Statistics
// report's funnel stages -- only the unambiguous ones. Routine adjustment
// visits and anything else stay unstaged; staff can tag those manually
// under Settings > Appointment Types same as always.
export const STAGE_BY_NAME: Record<string, string> = {
  'primera visita': 'first_visit',
  'oferta primera visita': 'first_visit_offer',
  'informe quiropractico': 'report',
  'revisión quiropractica': 'revision',
  'revision quiropractica': 'revision',
  'mantenimiento quiropractico': 'maintenance',
}

// PracticeHub keeps retired types, often a near-duplicate of a live one
// ("Primera Visita" beside "Primera visita"). One that is retired AND was
// never used is not brought across: on Columnaquiro that was five of fourteen,
// and a new clinic's type list started out with them.
export function isWorthBringing(phType: Pick<PHAppointmentType, 'active'>, used: number) {
  return used > 0 || !(phType.active === 0 || phType.active === false)
}

export function hexColor(value: string | null | undefined): string | null {
  const hex = (value ?? '').trim().replace(/^#/, '')
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null
}

export interface TypeHere { id: string; name: string; default_price_cents: number }
export interface VisitHere { id: string; external_reference: string; appointment_type_id: string | null }

export interface TypeCandidate {
  phTypeId: string
  name: string
  /** Set when a type of the same name is already here; null means it gets created. */
  ourTypeId: string | null
  /** The type's price here; null when it gets created. */
  ourPriceCents: number | null
  /** What the import writes as the type's price: PracticeHub's, and only over a 0. */
  priceToWrite: number | null
  funnelStage: string | null
  /** PracticeHub's appointments of this type that are already here, by reference. */
  appointmentRefs: string[]
  /** The visits here of this type that do not point at it yet (all of them, for a type still to be created). */
  relinkIds: string[]
  /** All of PracticeHub's appointments of this type, here or not. */
  inPracticeHub: number
  durationMinutes: number | null
  color: string | null
  /** Retired in PracticeHub but still on old visits: created archived, never offered. */
  archived: boolean
}

/**
 * Which PracticeHub types come across and what each one does here. Pure.
 * `services` is PracticeHub 2.0's /billable_items, or null when there are
 * none to price from.
 */
export function practiceHubTypeCandidates(input: {
  phTypes: PHAppointmentType[]
  phAppointments: PHTypedAppointment[]
  typesHere: TypeHere[]
  visitsHere: VisitHere[]
  services: PracticeHubBillableItem[] | null
}): { candidates: TypeCandidate[]; skippedNoMatch: number } {
  const typeNamed = byExactName(input.typesHere, (ty) => ty.name)
  const visitsByRef = new Map<string, VisitHere[]>()
  for (const v of input.visitsHere) {
    const list = visitsByRef.get(v.external_reference)
    if (list) list.push(v)
    else visitsByRef.set(v.external_reference, [v])
  }

  // Ids arrive as numbers from one list and strings from another, so they
  // are compared as text.
  const refsByPhTypeId = new Map<string, string[]>()
  const knownPhTypeIds = new Set(input.phTypes.map((phType) => String(phType.id)))
  let skippedNoMatch = 0
  for (const appt of input.phAppointments) {
    const typeId = appt.appointment_type_id ? String(appt.appointment_type_id) : ''
    if (!typeId || !knownPhTypeIds.has(typeId)) {
      skippedNoMatch++
      continue
    }
    const list = refsByPhTypeId.get(typeId) ?? []
    list.push(String(appt.id))
    refsByPhTypeId.set(typeId, list)
  }

  const candidates = input.phTypes
    .filter((phType) => isWorthBringing(phType, refsByPhTypeId.get(String(phType.id))?.length ?? 0))
    .map((phType): TypeCandidate => {
      const name = String(phType.name ?? '')
      const key = name.trim().toLowerCase()
      const refs = refsByPhTypeId.get(String(phType.id)) ?? []
      const ours = typeNamed(name)
      const ourPriceCents = ours ? ours.default_price_cents : null
      const phPrice = input.services ? practiceHubTypePrice(name, input.services) : null
      // Only the visits already here can be re-pointed. Counting PracticeHub's
      // own told a clinic with no appointments yet that 8,695 would be relinked.
      const appointmentRefs = refs.filter((ref) => visitsByRef.has(ref))
      const relinkIds = appointmentRefs.flatMap((ref) => visitsByRef.get(ref)!.filter((v) => !ours || v.appointment_type_id !== ours.id).map((v) => v.id))
      return {
        phTypeId: String(phType.id),
        name,
        ourTypeId: ours?.id ?? null,
        ourPriceCents,
        priceToWrite: practiceHubPriceToWrite(ourPriceCents, phPrice?.priceCents),
        funnelStage: STAGE_BY_NAME[key] ?? null,
        appointmentRefs,
        relinkIds,
        inPracticeHub: refs.length,
        durationMinutes: phType.duration && phType.duration > 0 ? phType.duration : null,
        color: hexColor(phType.color),
        archived: phType.active === 0 || phType.active === false,
      }
    })
  return { candidates, skippedNoMatch }
}

export const planAppointmentTypes: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phTypes = practiceHubList<PHAppointmentType>(snapshot, '/appointment_types')
  const phAppointments = practiceHubList<PHTypedAppointment>(snapshot, '/appointments')
  // Prices come from PracticeHub 2.0's API, the only one that has them
  // (utils/practicehubTypePrices.ts). A copy without them -- no 2.0 key, or
  // the read of them failed -- still brings the types across, without a
  // price, and a later sync with them fills in the ones still at 0.
  // Only 2.0's shape (description + amount) carries a price: Classic has no
  // services list, and anything else in the copy under that name would price
  // nothing while looking as if it had.
  const listed = snapshot.lists['/billable_items'] as PracticeHubBillableItem[] | undefined
  const services = listed?.some((item) => item && typeof item === 'object' && 'description' in item && 'amount' in item) ? listed : null

  const [typesHere, visitsHere] = await Promise.all([
    practiceHubTypesHere(supabase, accountId),
    readAllForAccount<VisitHere>(supabase, accountId, 'appointments', 'id, external_reference, appointment_type_id', (q) => q.not('external_reference', 'is', null)),
  ])
  const { candidates, skippedNoMatch } = practiceHubTypeCandidates({ phTypes, phAppointments, typesHere, visitsHere, services })

  const newTypeCount = new Set(candidates.filter((c) => !c.ourTypeId).map((c) => c.name.trim().toLowerCase())).size
  // Types already here that take PracticeHub's price. Two PracticeHub types of
  // one name are one type here, so it is counted once.
  const pricesToFill = new Set(candidates.filter((c) => c.ourTypeId && c.priceToWrite !== null).map((c) => c.ourTypeId)).size
  const toRelink = candidates.reduce((sum, c) => sum + c.relinkIds.length, 0)

  const priceLabel = (c: TypeCandidate) => {
    if (c.priceToWrite !== null) return formatEur(c.priceToWrite)
    if (c.ourPriceCents) return t(`${formatEur(c.ourPriceCents)} (kept)`, `${formatEur(c.ourPriceCents)} (se mantiene)`)
    return '—'
  }
  // The stage's name as Settings › Appointment types shows it, not its key.
  const stageLabel = (stage: string | null) => {
    const known = TYPE_STAGES.find((s) => s.value === stage)
    return known ? t(known.en, known.es) : '—'
  }

  return {
    stats: [
      { label: t('New types', 'Tipos nuevos'), value: nf.format(newTypeCount), tone: 'good' },
      { label: t('Prices to fill in', 'Precios a completar'), value: nf.format(pricesToFill), tone: 'good' },
      { label: t('Appointments to relink', 'Citas a revincular'), value: nf.format(toRelink), tone: 'good' },
      { label: t('Types already here', 'Tipos ya existentes'), value: nf.format(candidates.length - newTypeCount) },
      { label: t('No type in PracticeHub', 'Sin tipo en PracticeHub'), value: nf.format(skippedNoMatch) },
    ],
    columns: [
      { key: 'name', label: t('Appointment type', 'Tipo de cita') },
      { key: 'status', label: t('Status', 'Estado') },
      { key: 'price', label: t('Price', 'Precio') },
      { key: 'funnelStage', label: t('Stage', 'Etapa') },
      { key: 'appointments', label: t('Appointments', 'Citas') },
      { key: 'relink', label: t('To relink', 'A revincular') },
    ],
    rows: [...candidates]
      .sort((a, b) => b.inPracticeHub - a.inPracticeHub)
      .map((c) => ({
        name: c.name,
        status: c.ourTypeId ? t('Already here', 'Ya existe') : t('Will be created', 'Se creará') + (c.archived ? ` (${t('archived', 'archivado')})` : ''),
        price: priceLabel(c),
        funnelStage: stageLabel(c.funnelStage),
        appointments: nf.format(c.inPracticeHub),
        relink: nf.format(c.relinkIds.length),
      })),
    warnings: [
      ...(!services ? [t(
        'Prices are not brought across: PracticeHub only gives them through its 2.0 API, and this copy has none. Add the phk_ key under Connection and sync again; it fills in every price still at 0.',
        'Los precios no se traen: PracticeHub solo los da por su API 2.0 y esta copia no los tiene. Añade la clave phk_ en Conexión y vuelve a sincronizar; completará los precios que sigan a 0.',
      )] : []),
      ...(toRelink ? [t(
        'Relinking replaces the type a visit has here with the one PracticeHub gives it, even if someone changed it in QuiroFlow.',
        'Al revincular, el tipo que tiene la visita aquí se sustituye por el que le da PracticeHub, aunque alguien lo cambiara en QuiroFlow.',
      )] : []),
    ],
    total: newTypeCount + pricesToFill + toRelink,
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      let done = 0

      const ourTypeIdByPhTypeId = new Map<string, string>()
      // Two PracticeHub types can share a name; the second reuses the first
      // rather than creating a twin.
      const createdByName = new Map<string, string>()
      const priced = new Set<string>()
      for (const c of candidates) {
        if (shouldStop()) return { written, errors }
        const key = c.name.trim().toLowerCase()
        const known = c.ourTypeId ?? createdByName.get(key)
        if (known) {
          ourTypeIdByPhTypeId.set(c.phTypeId, known)
          if (c.ourTypeId && c.priceToWrite !== null && !priced.has(c.ourTypeId)) {
            priced.add(c.ourTypeId)
            // Only over a 0, checked again as it is written: a price the clinic
            // set between the preview and now is theirs, and stays.
            const { data, error } = await supabase
              .from('appointment_types')
              .update({ default_price_cents: c.priceToWrite })
              .eq('id', c.ourTypeId)
              .eq('account_id', accountId)
              .eq('default_price_cents', 0)
              .select('id')
            if (error) errors.push(t(`The price of "${c.name}" was not saved: ${error.message}`, `No se guardó el precio de "${c.name}": ${error.message}`))
            else written += data?.length ?? 0
            progress(++done)
          }
          continue
        }
        const { data: created, error } = await supabase
          .from('appointment_types')
          // Not bookable online: an imported type is the history's, and the
          // clinic decides which ones patients may book on the type's own page.
          // Its length and colour are PracticeHub's, so the calendar looks the
          // way the clinic is used to.
          .insert({
            account_id: accountId,
            name: c.name,
            stage: c.funnelStage,
            online_booking_enabled: false,
            ...(c.priceToWrite !== null ? { default_price_cents: c.priceToWrite } : {}),
            ...(c.durationMinutes ? { duration_minutes: c.durationMinutes } : {}),
            ...(c.color ? { color: c.color } : {}),
            ...(c.archived ? { archived_at: new Date().toISOString() } : {}),
          })
          .select('id')
          .single()
        if (error || !created) {
          errors.push(t(`The type "${c.name}" was not created: ${error?.message}`, `No se creó el tipo "${c.name}": ${error?.message}`))
          continue
        }
        ourTypeIdByPhTypeId.set(c.phTypeId, created.id)
        createdByName.set(key, created.id)
        written++
        progress(++done)
      }

      // Grouped by target type so each chunk is one bulk update instead of one
      // request per appointment -- 8000+ individual updates would be far too slow.
      const CHUNK = 200
      for (const c of candidates) {
        const ourTypeId = ourTypeIdByPhTypeId.get(c.phTypeId)
        if (!ourTypeId) continue
        for (let i = 0; i < c.relinkIds.length; i += CHUNK) {
          if (shouldStop()) return { written, errors }
          const chunk = c.relinkIds.slice(i, i + CHUNK)
          const { error, count } = await supabase
            .from('appointments')
            .update({ appointment_type_id: ourTypeId }, { count: 'exact' })
            .in('id', chunk)
            .eq('account_id', accountId)
          if (error) errors.push(t(`Some visits of "${c.name}" were not relinked: ${error.message}`, `Algunas visitas de "${c.name}" no se revincularon: ${error.message}`))
          else written += count ?? chunk.length
          done += chunk.length
          progress(done)
        }
      }
      return { written, errors }
    },
  }
}
