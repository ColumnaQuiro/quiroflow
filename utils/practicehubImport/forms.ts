import type { Json } from '~/types/database.types'
import { nationalIdAnswer, type DocField } from '~/utils/docFields'
import { practiceHubFormBlocks, practiceHubFormOptions, type PracticeHubFormField } from '~/utils/practicehubFormFields'
import { readAllForAccount, withConcurrency } from '~/utils/practicehubImport/appointments'
import { practiceHubList, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'

// The Form responses step of a PracticeHub import, run on the server
// (server/utils/importJobs.ts) from the copy of PracticeHub's Classic API in
// import_snapshots. It is components/import/PracticeHubCustomFormResponsesImporter.vue
// with the screen taken away: every submitted form (consent forms, health
// questionnaires, signed documents) becomes a completed document in the
// patient's Docs tab, each distinct form leaves a reusable template in
// Settings > Docs, and each patient's DNI from their newest form fills a
// blank one on their profile.
//
// The blocks come from the API's answers (utils/practicehubFormFields.ts).
// Rebuilding the templates from PracticeHub's own form editor
// (server/utils/practicehubFormTemplates.ts) is a separate action that signs
// in to PracticeHub's website, and is not part of this step.
//
// Insert-only, and recognised by reference: a response by "PH-form-<id>" on
// patient_docs, a template by "PH-form-template-<form_id>" on doc_templates.
// doc_templates has no unique index on that reference, so nothing in the
// database stops a second template; what stops it is that every plan looks
// the templates up by their reference first, and Apply writes the templates
// BEFORE any response. A slice that stops between the two leaves templates a
// re-plan finds, and responses it writes then.

// --- PracticeHub's rows, as the Classic API sends them ---------------------------------

export interface PracticeHubFormResponse {
  id: number
  form_id: string
  form_name: string
  patient_id: string | number
  data: PracticeHubFormField[] | null
  created: string
}

// --- shared with the browser importer ------------------------------------------------

export const practiceHubFormResponseReference = (responseId: number | string) => `PH-form-${responseId}`
/** The same reference server/utils/practicehubFormTemplates.ts finds the templates by, to rebuild them from PracticeHub's editor. */
export const practiceHubFormTemplateReference = (formId: string) => `PH-form-template-${formId}`

/** The patient's own DNI from a form's blocks: the first answer linked to national_id that reads as one, or null. */
export function practiceHubFormNationalId(blocks: DocField[]): string | null {
  return nationalIdAnswer(blocks.find((b) => b.patientField === 'national_id' && nationalIdAnswer(b.value))?.value)
}

/**
 * Keeps each patient's DNI from their NEWEST saved form that asks for it.
 * `at` is PracticeHub's created stamp, compared as text the way the browser
 * importer always has.
 */
export function keepNewestNationalId(byPatient: Map<string, { value: string; at: string }>, patientId: string, blocks: DocField[], at: string) {
  const value = practiceHubFormNationalId(blocks)
  const known = byPatient.get(patientId)
  if (value && (!known || at > known.at)) byPatient.set(patientId, { value, at })
}

// --- what to write, worked out without touching the database --------------------------

export interface PracticeHubTemplateCandidate { formId: string; formName: string; fields: DocField[] }
export interface PracticeHubFormCandidate {
  response: PracticeHubFormResponse
  ref: string
  patientId: string
  patientLabel: string
  blocks: DocField[]
}

export interface PracticeHubFormsInput {
  phPatients: { id: number | string; patient_number: string }[]
  responses: PracticeHubFormResponse[]
  ourPatientByRef: Map<string, { id: string; label: string }>
  /** References of the patient_docs already here. */
  haveDocRefs: Set<string>
  /** Templates already here, by their reference. */
  templateIdByRef: Map<string, string>
  newId?: () => string
}

export interface PracticeHubFormsRows {
  templates: PracticeHubTemplateCandidate[]
  /** Template id by PracticeHub form_id, for the forms whose template is already here. */
  existingTemplateIdByFormId: Map<string, string>
  candidates: PracticeHubFormCandidate[]
  /** Each matched patient's DNI from the forms already imported here, newest first wins. */
  nationalIdFromImported: Map<string, { value: string; at: string }>
  skippedDuplicate: number
  skippedUnmatched: number
}

export function practiceHubFormsRows(input: PracticeHubFormsInput): PracticeHubFormsRows {
  const newId = input.newId
  // PracticeHub's own patient id is not what we store: every importer keys
  // on patient_number. Compared as text: the Classic API sends ids as either.
  const patientNumberById = new Map(input.phPatients.map((p) => [String(p.id), p.patient_number]))

  // A response only ever tells us what ONE patient answered -- but the
  // form itself (its questions, in order) is the same for every patient
  // who filled it in. Without a template left behind, migrated forms only
  // ever exist as already-filled history: a patient who was never in
  // PracticeHub could never be sent "Protección de Datos" again, because
  // nothing reusable exists in Settings > Docs. One doc_templates row per
  // distinct PracticeHub form_id, built from the first response seen for
  // it, fixes that -- external_reference makes re-running this importer
  // safe instead of creating a duplicate template every time.
  const firstResponseByFormId = new Map<string, PracticeHubFormResponse>()
  const responsesByFormId = new Map<string, PracticeHubFormResponse[]>()
  for (const r of input.responses) {
    if (!firstResponseByFormId.has(r.form_id)) firstResponseByFormId.set(r.form_id, r)
    responsesByFormId.set(r.form_id, [...(responsesByFormId.get(r.form_id) ?? []), r])
  }
  // Each form's checkbox questions with every option seen ticked for them, so
  // a document lists the options the patient left unticked too.
  const optionsByFormId = new Map([...responsesByFormId].map(([formId, list]) => [formId, practiceHubFormOptions(list)]))

  const templates: PracticeHubTemplateCandidate[] = []
  const existingTemplateIdByFormId = new Map<string, string>()
  for (const [formId, sample] of firstResponseByFormId) {
    const existingId = input.templateIdByRef.get(practiceHubFormTemplateReference(formId))
    if (existingId) existingTemplateIdByFormId.set(formId, existingId)
    else templates.push({ formId, formName: sample.form_name, fields: practiceHubFormBlocks(sample.data, { blank: true, options: optionsByFormId.get(formId), newId }) })
  }

  const out: PracticeHubFormsRows = { templates, existingTemplateIdByFormId, candidates: [], nationalIdFromImported: new Map(), skippedDuplicate: 0, skippedUnmatched: 0 }
  for (const r of input.responses) {
    const ref = practiceHubFormResponseReference(r.id)
    const patientNumber = patientNumberById.get(String(r.patient_id))
    const patient = patientNumber ? input.ourPatientByRef.get(patientNumber) : undefined
    if (input.haveDocRefs.has(ref)) {
      out.skippedDuplicate++
      // Already saved here, so its DNI counts: a slice that wrote the forms
      // and stopped before filling the profiles leaves this to fill them.
      if (patient) keepNewestNationalId(out.nationalIdFromImported, patient.id, practiceHubFormBlocks(r.data, { options: optionsByFormId.get(r.form_id), newId }), r.created)
      continue
    }
    if (!patient) {
      out.skippedUnmatched++
      continue
    }
    out.candidates.push({
      response: r,
      ref,
      patientId: patient.id,
      patientLabel: patient.label,
      blocks: practiceHubFormBlocks(r.data, { options: optionsByFormId.get(r.form_id), newId }),
    })
  }
  return out
}

// --- the step ------------------------------------------------------------------------

const DOC_CHUNK = 100
const DNI_READ_CHUNK = 200
/** One row per request (each patient's value differs), this many at a time. */
const DNI_CONCURRENCY = 20

const previewDate = (at: string) => (/^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : at)

export const planCustomFormResponses: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phPatients = practiceHubList<{ id: number | string; patient_number: string }>(snapshot, '/patients')
  const responses = practiceHubList<PracticeHubFormResponse>(snapshot, '/custom_form_responses')

  // Each read throws when it fails: read as empty, every form and template
  // here would look new and be written a second time.
  const [patientRows, docRows, templateRows] = await Promise.all([
    readAllForAccount<{ id: string; external_reference: string | null; first_name: string; last_name: string | null; national_id: string | null }>(
      supabase, accountId, 'patients', 'id, external_reference, first_name, last_name, national_id',
      (q) => q.not('external_reference', 'is', null),
    ),
    readAllForAccount<{ external_reference: string | null }>(supabase, accountId, 'patient_docs', 'external_reference', (q) => q.like('external_reference', 'PH-form-%')),
    readAllForAccount<{ id: string; external_reference: string | null }>(supabase, accountId, 'doc_templates', 'id, external_reference', (q) => q.like('external_reference', 'PH-form-template-%')),
  ])
  const ourPatientByRef = new Map<string, { id: string; label: string }>()
  const nationalIdHere = new Map<string, string | null>()
  for (const p of patientRows) {
    if (!p.external_reference) continue
    ourPatientByRef.set(p.external_reference, { id: p.id, label: `${p.first_name} ${p.last_name ?? ''}`.trim() })
    nationalIdHere.set(p.id, p.national_id)
  }

  const { templates, existingTemplateIdByFormId, candidates, nationalIdFromImported, skippedDuplicate, skippedUnmatched } = practiceHubFormsRows({
    phPatients,
    responses,
    ourPatientByRef,
    haveDocRefs: new Set(docRows.map((d) => d.external_reference).filter(Boolean) as string[]),
    templateIdByRef: new Map(templateRows.map((tpl) => [tpl.external_reference as string, tpl.id])),
  })

  // Only a blank DNI is filled: one already on the profile was typed or
  // checked by the clinic, and an old form is no reason to replace it. Who
  // gets one, if every form planned is saved -- Apply works it out again
  // from the forms actually saved.
  const nationalIdIfSaved = new Map(nationalIdFromImported)
  for (const c of candidates) keepNewestNationalId(nationalIdIfSaved, c.patientId, c.blocks, c.response.created)
  const dniPatients = [...nationalIdIfSaved.keys()].filter((id) => !nationalIdHere.get(id)?.trim())

  return {
    stats: [
      { label: t('Will import', 'Se importarán'), value: nf.format(candidates.length), tone: 'good' },
      { label: t('New templates', 'Plantillas nuevas'), value: nf.format(templates.length) },
      { label: t('Already imported', 'Ya importados'), value: nf.format(skippedDuplicate) },
      { label: t('No matching patient', 'Sin paciente coincidente'), value: nf.format(skippedUnmatched) },
      { label: t('DNI to add to patient profiles', 'DNI a añadir a las fichas'), value: nf.format(dniPatients.length) },
    ],
    columns: [
      { key: 'date', label: t('Date', 'Fecha') },
      { key: 'patient', label: t('Patient', 'Paciente') },
      { key: 'form', label: t('Form', 'Formulario') },
      { key: 'answers', label: t('Answers', 'Respuestas') },
    ],
    rows: candidates.map((c) => ({
      date: previewDate(c.response.created),
      patient: c.patientLabel,
      form: c.response.form_name,
      answers: String((c.response.data ?? []).length),
    })),
    warnings: [
      ...(templates.length
        ? [t(
          `Templates that will be created in Settings → Docs: ${templates.map((tpl) => tpl.formName).join(', ')}`,
          `Plantillas que se crearán en Ajustes → Documentos: ${templates.map((tpl) => tpl.formName).join(', ')}`,
        )]
        : []),
      ...(skippedUnmatched
        ? [t(
          `${nf.format(skippedUnmatched)} forms are skipped because their patient is not here yet. Run Patients first.`,
          `Se omiten ${nf.format(skippedUnmatched)} formularios porque su paciente aún no está aquí. Ejecuta antes Pacientes.`,
        )]
        : []),
    ],
    total: templates.length + candidates.length + dniPatients.length,

    // `written` counts templates and forms created and profiles given a DNI.
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      let done = 0
      const templateIdByFormId = new Map(existingTemplateIdByFormId)

      // Templates first, so a slice stopped after them leaves templates the
      // next plan finds by reference rather than creates again.
      for (const tpl of templates) {
        if (shouldStop()) return { written, errors }
        const { data: newTemplate, error } = await supabase
          .from('doc_templates')
          .insert({
            account_id: accountId,
            title: tpl.formName,
            fields: tpl.fields as unknown as Json,
            external_reference: practiceHubFormTemplateReference(tpl.formId),
          })
          .select('id')
          .single()
        if (error) errors.push(t(`The template "${tpl.formName}" was not created: ${error.message}`, `No se creó la plantilla "${tpl.formName}": ${error.message}`))
        else {
          written++
          templateIdByFormId.set(tpl.formId, newTemplate.id)
        }
        progress(++done)
      }

      // Each patient's DNI from the newest saved form that asks for it. A form
      // filled in here writes its linked answers onto the profile as it is
      // completed (save_public_patient_doc); an imported one arrives already
      // completed and never passes through that, so it is done here instead.
      const dniByPatient = new Map(nationalIdFromImported)
      for (let i = 0; i < candidates.length; i += DOC_CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = candidates.slice(i, i + DOC_CHUNK)
        const { data, error } = await supabase
          .from('patient_docs')
          .insert(chunk.map((c) => ({
            account_id: accountId,
            patient_id: c.patientId,
            template_id: templateIdByFormId.get(c.response.form_id) ?? null,
            title: c.response.form_name,
            fields: c.blocks as unknown as Json,
            completed_at: c.response.created,
            external_reference: c.ref,
            created_at: c.response.created,
          })))
          .select('id')
        if (error) {
          errors.push(t(`Forms ${i + 1}-${i + chunk.length} were not saved: ${error.message}`, `No se guardaron los formularios ${i + 1}-${i + chunk.length}: ${error.message}`))
        } else {
          written += data?.length ?? 0
          for (const c of chunk) keepNewestNationalId(dniByPatient, c.patientId, c.blocks, c.response.created)
        }
        done += chunk.length
        progress(done)
      }

      // Only the patients the plan found blank, read again before writing:
      // one given a DNI by hand since the plan keeps it.
      const planned = new Set(dniPatients)
      const dniPatientIds = [...dniByPatient.keys()].filter((id) => planned.has(id))
      for (let i = 0; i < dniPatientIds.length; i += DNI_READ_CHUNK) {
        if (shouldStop()) return { written, errors }
        const ids = dniPatientIds.slice(i, i + DNI_READ_CHUNK)
        const { data: current, error: readError } = await supabase.from('patients').select('id, national_id').eq('account_id', accountId).in('id', ids)
        if (readError) {
          errors.push(t(`DNI was not added to ${ids.length} patients: ${readError.message}`, `No se añadió el DNI a ${ids.length} pacientes: ${readError.message}`))
        } else {
          const blank = (current ?? []).filter((p) => !p.national_id?.trim())
          await withConcurrency(blank, DNI_CONCURRENCY, async (p) => {
            const { error } = await supabase.from('patients').update({ national_id: dniByPatient.get(p.id)!.value }).eq('id', p.id).eq('account_id', accountId)
            if (error) errors.push(t(`DNI was not added to a patient: ${error.message}`, `No se añadió el DNI a un paciente: ${error.message}`))
            else written++
          })
        }
        done += ids.length
        progress(done)
      }

      return { written, errors }
    },
  }
}
